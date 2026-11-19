import { Hono, type Context } from 'hono'
import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { previewImageUrl } from './cover'
import { isSharePath, parseSharePath, sharePath } from './path'
import {
  followedLinkPage,
  followedLinkPolicy,
  UNAVAILABLE_POLICY,
  unavailablePage,
  type UnavailableKind,
  viewerPage,
  viewerPolicy,
} from './pages'
import { currentOwner } from '../auth/owner-middleware'
import { randomToken } from '../auth/owner-session'
import { homePagePolicy, renderPage } from '../decks/pages'
import { PROFILE_DECKS_SHOWN, profileBody } from './list-pages'
import {
  findVisibleAuthor,
  listPublicDecks,
  readSharedDeployment,
} from './store'
import type { FollowState, ViewerAuthorState } from '../follows/pages'
import { isFollowing } from '../follows/store'
import { hasMuted } from '../mutes/store'
import { readProfile } from '../profile/store'
import { readSuspension } from '../publication/suspension-store'
import { alternateLinks, LANG_PARAM, langOfTag } from '../site/i18n'
import { langOf } from '../site/lang'

export const shareRoutes = new Hono<{
  Bindings: Env
  Variables: { framedBySelf?: boolean }
}>()

/**
 * The signed-in reader, whose mutes shape the lists on the page. A page made
 * for one reader is marked so that no shared cache keeps it.
 */
async function viewerId<E extends { Bindings: Env }>(c: Context<E>) {
  const owner = await currentOwner(c, { allowSuspended: true })
  if (owner) c.header('Cache-Control', 'private, no-cache')
  return owner?.userId ?? null
}

/** Only an active reader of another author's page can follow or mute. */
async function activeReader(
  database: D1Database,
  viewer: string | null,
  author: string,
) {
  if (viewer === null || viewer === author) return null
  return (await readSuspension(database, viewer)) ? null : viewer
}

async function followState(
  database: D1Database,
  reader: string,
  author: string,
): Promise<FollowState> {
  return (await isFollowing(database, { follower: reader, followee: author }))
    ? 'following'
    : 'can-follow'
}

async function profileReader<E extends { Bindings: Env }>(
  c: Context<E>,
  author: string,
) {
  const viewer = await viewerId(c)
  if (viewer === author) return 'owner'
  const reader = await activeReader(c.env.DB, viewer, author)
  if (reader === null) return 'none'
  if (await hasMuted(c.env.DB, { muter: reader, muted: author })) return 'none'
  return followState(c.env.DB, reader, author)
}

async function deckControls(
  database: D1Database,
  viewer: string | null,
  author: string,
): Promise<ViewerAuthorState> {
  const reader = await activeReader(database, viewer, author)
  if (reader === null) return 'none'
  const [muted, follow] = await Promise.all([
    hasMuted(database, { muter: reader, muted: author }),
    followState(database, reader, author),
  ])
  return muted ? 'muted' : follow
}

/**
 * Every path under `/@`, however spelled, is answered here: the viewer, a
 * redirect to the canonical spelling, or the one unavailable page.
 */
shareRoutes.get('*', async (c, next) => {
  const raw = new URL(c.req.url).pathname
  if (!isSharePath(raw)) return next()
  // Readers revalidate, so a stop or replacement shows on the next visit.
  c.header('Cache-Control', 'no-cache')
  const lang = langOf(c)
  const url = new URL(c.req.url)
  const unavailable = (kind?: UnavailableKind) => {
    c.header('Content-Security-Policy', UNAVAILABLE_POLICY)
    c.header('X-Robots-Tag', 'noindex')
    return c.html(unavailablePage(lang, url, kind), 404)
  }
  const path = parseSharePath(raw)
  // A chosen language survives the move to the canonical spelling, for
  // clients that keep no cookie.
  const chosen = langOfTag(url.searchParams.get(LANG_PARAM) ?? undefined)
  if (path.kind === 'redirect')
    return c.redirect(
      chosen ? `${path.path}?${LANG_PARAM}=${chosen}` : path.path,
      301,
    )
  if (path.kind === 'invalid') return unavailable()
  if (path.kind === 'profile') {
    const author = await findVisibleAuthor(c.env.DB, path.handle)
    if (!author) return unavailable('profile')
    const base = contentBaseOf(c.env)
    const [profile, decks, reader] = await Promise.all([
      readProfile(c.env.DB, author.userId),
      listPublicDecks(c.env.DB, {
        handle: path.handle,
        limit: PROFILE_DECKS_SHOWN,
      }),
      profileReader(c, author.userId),
    ])
    c.header('Link', alternateLinks(c.env.PUBLIC_ORIGIN, url))
    return renderPage(
      c,
      `@${path.handle}`,
      profileBody(path.handle, profile, decks, reader, lang, base),
      200,
      homePagePolicy(base),
    )
  }
  // A deck's link to another deck loads in the deck's own frame.
  c.header('Vary', 'Sec-Fetch-Dest', { append: true })
  if (c.req.header('Sec-Fetch-Dest') === 'iframe') {
    const nonce = randomToken()
    c.header('Content-Security-Policy', followedLinkPolicy(nonce))
    c.header('X-Robots-Tag', 'noindex')
    c.set('framedBySelf', true)
    return c.html(followedLinkPage(nonce))
  }
  const base = contentBaseOf(c.env)
  if (!base) return unavailable()
  // Read from D1 on every view: the pointer decides what readers see.
  const shared = await readSharedDeployment(c.env.DB, path.handle, path.slug)
  if (!shared) return unavailable()
  const contentOrigin = deploymentOrigin(base, shared.id)
  const page = path.kind === 'page' ? path.page : null
  const viewer = await viewerId(c)
  const [controls, author] = await Promise.all([
    deckControls(c.env.DB, viewer, shared.ownerUserId),
    readProfile(c.env.DB, shared.ownerUserId),
  ])
  c.header('Content-Security-Policy', viewerPolicy(contentOrigin))
  c.header('Link', alternateLinks(c.env.PUBLIC_ORIGIN, url))
  return c.html(
    viewerPage(
      {
        handle: path.handle,
        slug: path.slug,
        title: shared.title,
        description: shared.description,
        imageUrl: new URL(
          previewImageUrl(base, shared, page),
          c.env.PUBLIC_ORIGIN,
        ).href,
        shareUrl: new URL(
          sharePath(path.handle, path.slug, page ?? undefined),
          c.env.PUBLIC_ORIGIN,
        ).href,
        // Decks that page by number read it from the fragment.
        contentUrl:
          page === null ? `${contentOrigin}/` : `${contentOrigin}/#${page}`,
        controls,
        author: {
          name: author?.name ?? null,
          avatarUrl: author?.avatarUrl ?? null,
        },
      },
      lang,
      url,
    ),
  )
})
