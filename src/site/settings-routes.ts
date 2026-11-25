import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import type { Owner } from '../auth/owner-session'
import { accountTitles, renderPage, signInPrompt } from '../decks/pages'
import { listConnections } from '../mcp/connections-store'
import { mcpResource } from '../mcp/oauth-metadata'
import { readHandle } from '../share/store'
import {
  checkProfile,
  fieldsOfForm,
  type ProfileFields,
  type ProfileProblem,
} from '../profile/profile-input'
import {
  readEmail,
  readProfile,
  saveProfile,
  type StoredProfile,
} from '../profile/store'
import { facePath, faceSourceOf } from '../profile/face'
import { forgetGravatar } from '../profile/gravatar-store'
import {
  PICTURE_PNG_MAX_BYTES,
  type PictureRefusal,
} from '../profile/picture-policy'
import { cleanPicturePng } from '../profile/picture-png'
import {
  readPictureTime,
  removePicture,
  savePicture,
} from '../profile/picture-store'
import type { PictureView } from './settings-profile-frame'
import { listMuted } from '../mutes/store'
import { readOptOuts } from '../notifications/store'
import { langOf } from './lang'
import { settingsBody, settingsTitle } from './settings-pages'

export const settingsRoutes = new Hono<{ Bindings: Env }>()

/** What just happened on the page, as far as its forms are concerned. */
type Outcome = Readonly<{
  /** The profile fields as typed, when a refused form is shown again. */
  fields?: ProfileFields
  problems?: readonly ProfileProblem[]
  saved?: boolean
  picture?: PictureView['result']
}>

/** The form as it opens: what the author saved, or empty before they did. */
const savedFields = (profile: StoredProfile | null): ProfileFields => ({
  name: profile?.name ?? '',
  bio: profile?.bio ?? '',
  location: profile?.location ?? '',
  website: profile?.website ?? '',
  links: profile?.links ?? [],
  useGravatar: profile?.useGravatar ?? true,
})

/** Draws the settings page. `outcome` says what its forms just did. */
async function settingsPage(
  c: Context<{ Bindings: Env }>,
  owner: Owner,
  outcome: Outcome,
  status: 200 | 400,
) {
  const lang = langOf(c)
  const [handle, email, profile, pictureTime, muted, optOuts, connections] =
    await Promise.all([
      readHandle(c.env.DB, owner.userId),
      readEmail(c.env.DB, owner.userId),
      readProfile(c.env.DB, owner.userId),
      readPictureTime(c.env.DB, owner.userId),
      listMuted(c.env.DB, owner.userId),
      readOptOuts(c.env.DB, owner.userId),
      listConnections(c.env.DB, owner.userId, Math.floor(Date.now() / 1000)),
    ])
  return renderPage(
    c,
    settingsTitle(lang),
    settingsBody(
      {
        login: owner.login,
        // Whoever has an owner session has an account, so both exist.
        handle: handle ?? owner.login,
        email: email ?? '',
        profileForm: {
          fields: outcome.fields ?? savedFields(profile),
          problems: outcome.problems ?? [],
          saved: outcome.saved ?? false,
          picture: {
            // The same address as every other place that shows the face.
            src:
              profile?.avatarUrl ??
              facePath(
                owner.userId,
                faceSourceOf({
                  uploadedAt: pictureTime,
                  useGravatar: true,
                  gravatarAt: null,
                }),
              ),
            uploaded: pictureTime !== null,
            result: outcome.picture ?? { kind: 'none' },
          },
        },
        muted,
        optOuts,
        agents: { mcpUrl: mcpResource(c.env.PUBLIC_ORIGIN), connections },
      },
      lang,
      new URL(c.req.url),
    ),
    status,
    undefined,
    'narrow',
  )
}

const signedOutPage = (c: Context<{ Bindings: Env }>) => {
  const lang = langOf(c)
  return renderPage(c, accountTitles(lang).signInTitle, signInPrompt(lang), 401)
}

settingsRoutes.get('/settings', async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return signedOutPage(c)
  const done = c.req.query('saved')
  return settingsPage(
    c,
    owner,
    {
      saved: done === 'profile',
      picture:
        done === 'picture'
          ? { kind: 'changed' }
          : done === 'picture-removed'
            ? { kind: 'removed' }
            : undefined,
    },
    200,
  )
})

settingsRoutes.post('/settings/profile', csrf(), async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return signedOutPage(c)
  const body = await c.req.parseBody({ all: true })
  const current = await readProfile(c.env.DB, owner.userId)
  const fields = fieldsOfForm(body, current?.useGravatar ?? true)
  const check = checkProfile(fields)
  if (check.kind === 'invalid')
    return settingsPage(c, owner, { fields, problems: check.problems }, 400)
  await saveProfile(c.env.DB, owner.userId, check.profile)
  // Turned off, the kept Gravatar picture has no use: it goes (saveProfile
  // forgets when it was asked).
  if (current?.useGravatar !== false && !check.profile.useGravatar)
    await forgetGravatar(c.env.UPLOADS, owner.userId)
  return c.redirect('/settings?saved=profile#profile', 303)
})

/** Room for the form around a picture's bytes. */
const FORM_OVERHEAD_BYTES = 64 * 1024

/**
 * The settings page shrinks a chosen picture in the browser and sends a
 * 256 by 256 PNG. The service keeps that PNG, stripped of the chunks it is
 * not shown with, and refuses anything else, however it was sent.
 */
settingsRoutes.post('/settings/picture', csrf(), async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return signedOutPage(c)
  const refuse = (reason: PictureRefusal) =>
    settingsPage(c, owner, { picture: { kind: 'refused', reason } }, 400)
  // A body far over the limit is refused before it is read.
  const declared = Number(c.req.header('Content-Length') ?? 0)
  if (declared > PICTURE_PNG_MAX_BYTES + FORM_OVERHEAD_BYTES)
    return refuse('not_shrunk')
  const body = await c.req.parseBody()
  const file = body.picture
  if (!(file instanceof File) || file.size === 0) return refuse('no_file')
  if (file.size > PICTURE_PNG_MAX_BYTES) return refuse('not_shrunk')
  const picture = cleanPicturePng(new Uint8Array(await file.arrayBuffer()))
  if (picture.kind === 'refused') return refuse('not_shrunk')
  await savePicture(
    { database: c.env.DB, bucket: c.env.UPLOADS },
    {
      userId: owner.userId,
      bytes: picture.bytes,
      contentType: 'image/png',
      // In milliseconds: the time is the picture's version in its address.
      now: Date.now(),
    },
  )
  return c.redirect('/settings?saved=picture#profile', 303)
})

settingsRoutes.post('/settings/picture/remove', csrf(), async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return signedOutPage(c)
  await removePicture(
    { database: c.env.DB, bucket: c.env.UPLOADS },
    owner.userId,
  )
  return c.redirect('/settings?saved=picture-removed#profile', 303)
})
