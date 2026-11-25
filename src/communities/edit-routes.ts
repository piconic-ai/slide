import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import type { Owner } from '../auth/owner-session'
import { deckTitles, notFoundBody, renderPage } from '../decks/pages'
import { mayRenameEvent, parseEventName } from '../events/event-rename'
import { renameEvent } from '../events/store'
import { FACE_ASKED_AGAIN, FACE_KEPT } from '../profile/face'
import { cleanPng } from '../profile/picture-png'
import { profilePath } from '../share/path'
import { langOf } from '../site/lang'
import type { Community } from './community'
import { editFormOf, readEditForm, type EditCommunityForm } from './edit-form'
import {
  EDIT_NOTICES,
  editPageBody,
  editPageTitle,
  type EditNotice,
} from './edit-page'
import { listEventAdmins } from './event-communities-store'
import {
  IMAGE_RULES,
  isCommunityImage,
  type CommunityImage,
} from './image-policy'
import {
  readCommunityImage,
  removeCommunityImage,
  saveCommunityImage,
} from './image-store'
import { markTaken, type FormBody } from './new-form'
import { findCommunity, isCommunityAdmin } from './page-store'
import {
  listRenamableEvents,
  replaceCommunityLinks,
  updateCommunity,
} from './store'

type AppEnv = { Bindings: Env }

/** The forms of a community's editing page, and its pictures. */
export const communityEditForms = new Hono<AppEnv>()

/** A community's number as a path spells it. */
export const communityIdOf = (text: string | undefined) =>
  text !== undefined &&
  /^[1-9][0-9]{0,15}$/u.test(text) &&
  Number.isSafeInteger(Number(text))
    ? Number(text)
    : null

/**
 * The community a request may change, and who asks: only a signed-in admin
 * of it (F30-AC26). Anyone else, and a community that is not there, get
 * null alike, so nobody learns who runs what.
 */
export async function adminRequest<E extends AppEnv>(
  c: Context<E>,
  communityId: number | null,
): Promise<Readonly<{ owner: Owner; community: Community }> | null> {
  if (communityId === null) return null
  const owner = await currentOwner(c)
  if (!owner) return null
  if (!(await isCommunityAdmin(c.env.DB, communityId, owner.userId)))
    return null
  const community = await findCommunity(c.env.DB, communityId)
  return community ? { owner, community } : null
}

const notFound = <E extends AppEnv>(c: Context<E>) => {
  const lang = langOf(c)
  return renderPage(c, deckTitles(lang).notFoundTitle, notFoundBody(lang), 404)
}

const noticeOf = (value: string | undefined): EditNotice =>
  EDIT_NOTICES.find((notice) => notice === value) ?? null

const editPage = async <E extends AppEnv>(
  c: Context<E>,
  input: Readonly<{
    community: Community
    form: EditCommunityForm
    notice: EditNotice
  }>,
  status: 200 | 400 | 409 = 200,
) => {
  const lang = langOf(c)
  const events = await listRenamableEvents(c.env.DB, input.community.id)
  return renderPage(
    c,
    editPageTitle(lang),
    editPageBody({ ...input, events }, lang),
    status,
    undefined,
    'narrow',
  )
}

/**
 * `/@handle/edit`: the editing page, for the community's admins alone. The
 * page answers anyone else as missing.
 */
export async function showCommunityEdit<E extends AppEnv>(
  c: Context<E>,
  communityId: number,
  unavailable: () => Response | Promise<Response>,
): Promise<Response> {
  const asked = await adminRequest(c, communityId)
  if (!asked) return unavailable()
  return editPage(c, {
    community: asked.community,
    form: editFormOf(asked.community),
    notice: noticeOf(c.req.query('notice')),
  })
}

const backToEdit = (community: Community, notice: EditNotice) =>
  `${profilePath(community.handle)}/edit${notice ? `?notice=${notice}` : ''}`

/**
 * Saves what an admin changed (F30-AC25): the name, the description, the
 * other links and the links. A link another community holds is not taken,
 * and nothing is saved.
 */
communityEditForms.post('/communities/:id/edit', csrf(), async (c) => {
  const asked = await adminRequest(c, communityIdOf(c.req.param('id')))
  if (!asked) return notFound(c)
  const { community } = asked
  const read = readEditForm((await c.req.parseBody({ all: true })) as FormBody)
  if (read.kind === 'edited')
    return editPage(c, { community, form: read.form, notice: null })
  if (read.kind === 'refused')
    return editPage(c, { community, form: read.form, notice: null }, 400)
  const links = await replaceCommunityLinks(c.env.DB, {
    communityId: community.id,
    links: read.links,
    now: Math.floor(Date.now() / 1000),
  })
  if (links.kind === 'links')
    return editPage(
      c,
      {
        community,
        form: {
          ...read.form,
          links: markTaken(read.form.links, links.conflicts),
        },
        notice: null,
      },
      409,
    )
  await updateCommunity(c.env.DB, {
    communityId: community.id,
    name: read.name,
    description: read.description,
    sites: read.sites,
  })
  return c.redirect(backToEdit(community, 'saved'), 303)
})

/** Room for the form around a picture's bytes. */
const FORM_OVERHEAD_BYTES = 64 * 1024

/**
 * Puts up a logo or a cover (F30-AC29, F30-AC30). The page shrinks the
 * chosen picture in the browser and sends a PNG of the shape the picture
 * takes; the service keeps that PNG, stripped of what it is not shown
 * with, and refuses anything else, however it was named or sent.
 */
communityEditForms.post(
  '/communities/:id/:image{(?:logo|cover)}',
  csrf(),
  async (c) => {
    const image = c.req.param('image')
    const asked = await adminRequest(c, communityIdOf(c.req.param('id')))
    if (!asked || !isCommunityImage(image)) return notFound(c)
    const { community } = asked
    const rule = IMAGE_RULES[image].png
    const refuse = () =>
      editPage(
        c,
        { community, form: editFormOf(community), notice: 'image-refused' },
        400,
      )
    const declared = Number(c.req.header('Content-Length') ?? 0)
    if (declared > rule.maxBytes + FORM_OVERHEAD_BYTES) return refuse()
    const file = (await c.req.parseBody()).image
    if (!(file instanceof File) || file.size === 0 || file.size > rule.maxBytes)
      return refuse()
    const png = cleanPng(new Uint8Array(await file.arrayBuffer()), rule)
    if (png.kind === 'refused') return refuse()
    await saveCommunityImage(
      { database: c.env.DB, bucket: c.env.UPLOADS },
      // In milliseconds: the time is the picture's version in its address.
      { communityId: community.id, image, bytes: png.bytes, now: Date.now() },
    )
    return c.redirect(backToEdit(community, image), 303)
  },
)

/** Back to the initial, or to the default pattern (F30-AC31). */
communityEditForms.post(
  '/communities/:id/:image{(?:logo|cover)}/remove',
  csrf(),
  async (c) => {
    const image = c.req.param('image')
    const asked = await adminRequest(c, communityIdOf(c.req.param('id')))
    if (!asked || !isCommunityImage(image)) return notFound(c)
    await removeCommunityImage(
      { database: c.env.DB, bucket: c.env.UPLOADS },
      { communityId: asked.community.id, image },
    )
    return c.redirect(
      backToEdit(asked.community, `${image}-removed` as const),
      303,
    )
  },
)

/**
 * Renames an event (F29-AC22): only the admins of a community the event is
 * in may.
 */
communityEditForms.post(
  '/communities/:id/events/:event/rename',
  csrf(),
  async (c) => {
    const asked = await adminRequest(c, communityIdOf(c.req.param('id')))
    const eventId = communityIdOf(c.req.param('event'))
    if (!asked || eventId === null) return notFound(c)
    const admins = await listEventAdmins(c.env.DB, eventId)
    if (
      !admins.has(asked.owner.userId) ||
      !mayRenameEvent({ kind: 'person', userId: asked.owner.userId }, admins)
    )
      return notFound(c)
    const name = parseEventName((await c.req.parseBody()).name)
    if (name === null)
      return c.redirect(backToEdit(asked.community, 'name-refused'), 303)
    await renameEvent(c.env.DB, {
      eventId,
      name,
      by: asked.owner.userId,
      now: Math.floor(Date.now() / 1000),
    })
    return c.redirect(backToEdit(asked.community, 'renamed'), 303)
  },
)

/** What every picture answer says: an image and nothing else. */
const IMAGE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
} as const

/**
 * A community's logo or cover, as it was put up. Asked for under its own
 * version, it may be kept long; otherwise it is asked for again.
 */
communityEditForms.get('/communities/:id/:image{(?:logo|cover)}', async (c) => {
  const communityId = communityIdOf(c.req.param('id'))
  const image = c.req.param('image') as CommunityImage
  const community =
    communityId === null ? null : await findCommunity(c.env.DB, communityId)
  const at = community
    ? image === 'logo'
      ? community.logoAt
      : community.coverAt
    : null
  const stored =
    community && at !== null
      ? await readCommunityImage(c.env.UPLOADS, community.id, image)
      : null
  if (!stored)
    return new Response(null, {
      status: 404,
      headers: { ...IMAGE_HEADERS, 'Cache-Control': FACE_ASKED_AGAIN },
    })
  return new Response(stored.body, {
    headers: {
      ...IMAGE_HEADERS,
      'Content-Type': 'image/png',
      'Cache-Control':
        c.req.query('v') === String(at) ? FACE_KEPT : FACE_ASKED_AGAIN,
    },
  })
})
