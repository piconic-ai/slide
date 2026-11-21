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
import { avatarPath } from '../profile/face'
import {
  checkPictureFile,
  PICTURE_MAX_BYTES,
  type PictureRefusal,
  type PictureShrinker,
} from '../profile/picture-policy'
import { imagesShrinker } from '../profile/picture-client'
import { squarePng } from '../profile/png-square'
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
  status: 200 | 400 | 503,
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
            // The time in the address makes a new picture a new address.
            src: `${avatarPath(owner.userId)}${pictureTime === null ? '' : `?v=${pictureTime}`}`,
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
  return c.redirect('/settings?saved=profile#profile', 303)
})

/**
 * What shrinks pictures here: the Images binding where there is one, the
 * Worker's own PNG shrinker where PICTURE_LOCAL is on, otherwise nothing.
 */
const shrinkerOf = (env: Env): PictureShrinker | null =>
  env.IMAGES
    ? imagesShrinker(env.IMAGES)
    : env.PICTURE_LOCAL === 'on'
      ? squarePng
      : null

/** Room for the form around a picture's bytes. */
const FORM_OVERHEAD_BYTES = 64 * 1024

settingsRoutes.post('/settings/picture', csrf(), async (c) => {
  const owner = await currentOwner(c)
  if (!owner) return signedOutPage(c)
  const refuse = (reason: PictureRefusal) =>
    settingsPage(
      c,
      owner,
      { picture: { kind: 'refused', reason } },
      reason === 'unavailable' ? 503 : 400,
    )
  // With no image service, nothing is stored: the original is never kept.
  const shrink = shrinkerOf(c.env)
  if (!shrink) return refuse('unavailable')
  // A body far over the limit is refused before it is read.
  const declared = Number(c.req.header('Content-Length') ?? 0)
  if (declared > PICTURE_MAX_BYTES + FORM_OVERHEAD_BYTES)
    return refuse('too_large')
  const body = await c.req.parseBody()
  const file = body.picture
  if (!(file instanceof File)) return refuse('no_file')
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const checked = checkPictureFile(file.size, head)
  if (checked.kind === 'refused') return refuse(checked.reason)
  const square = await shrink(new Uint8Array(await file.arrayBuffer()))
  if (square.kind === 'refused') return refuse(square.reason)
  await savePicture(
    { database: c.env.DB, bucket: c.env.UPLOADS },
    {
      userId: owner.userId,
      bytes: square.bytes,
      contentType: square.contentType,
      now: Math.floor(Date.now() / 1000),
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
