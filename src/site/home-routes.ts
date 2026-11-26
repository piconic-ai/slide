import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { OWNER_COOKIE } from '../auth/config'
import { currentOwner } from '../auth/owner-middleware'
import { homePagePolicy } from '../decks/pages'
import { contentBaseOf } from '../preview/config'
import { RECENT_DECKS_SHOWN } from '../share/list-pages'
import { citedKey } from '../citations/cited-count'
import { readCitedCounts } from '../citations/pair-store'
import { toRecentDeck } from '../share/recent'
import { listPublicDecks } from '../share/store'
import { HOME_ASSET_PATHS } from './home-assets'
import { parseCommunityPage, parseDeckPage } from './home-more-query'
import { toHomeCommunityCard } from '../communities/community-card'
import { listFollowedCommunityTalks } from '../communities/feed-store'
import { listNewCommunities } from '../communities/list-store'
import { followsAnyCommunity } from '../communities/follow-store'
import { toHomeCommunities } from './home-communities'
import { toHomeLists } from './home-lists'
import {
  HOME_COMMUNITIES_SHOWN,
  HOME_FOLLOWING_SHOWN,
  HOME_NEW_COMMUNITIES_SHOWN,
} from './home-shape'
import { markViewer, type HomeViewer } from './home-viewer'
import { alternateLinks } from './i18n'
import { langOf } from './lang'

/** Request headers that let Static Assets answer 304 for the top page. */
const CONDITIONAL_HEADERS = ['If-None-Match', 'If-Modified-Since'] as const

export const homeRoutes = new Hono<{ Bindings: Env }>()

const VISITOR: HomeViewer = { kind: 'visitor' }

/**
 * A visitor with a session cookie, and whether the session holds and
 * follows a community. A suspended person's page is marked as it was
 * before; the lists then answer them as they do.
 */
async function memberViewer(
  c: Context<{ Bindings: Env }>,
): Promise<HomeViewer> {
  const owner = await currentOwner(c, { allowSuspended: true })
  return {
    kind: 'member',
    followsCommunity:
      owner !== null && (await followsAnyCommunity(c.env.DB, owner.userId)),
  }
}

/**
 * The top page is built ahead of time, one file per language. It is served
 * here rather than straight from Static Assets so it carries the page
 * headers. A visitor who has a session cookie gets it marked as theirs (see
 * home-viewer.ts); only for them is D1 read, to learn whether they follow a
 * community (F31-AC16). Each file has its own ETag, so a page seen in one
 * language is not revalidated as the other.
 */
homeRoutes.get('/', async (c) => {
  // A visitor with a session cookie gets the page marked for them, so a body
  // kept for someone else is never revalidated into theirs.
  const member = Boolean(getCookie(c, OWNER_COOKIE))
  const viewer = member ? await memberViewer(c) : VISITOR
  const headers = new Headers()
  if (!member)
    for (const name of CONDITIONAL_HEADERS) {
      const value = c.req.header(name)
      if (value) headers.set(name, value)
    }
  const asset = await c.env.ASSETS.fetch(
    new Request(new URL(HOME_ASSET_PATHS[langOf(c)], c.req.url), { headers }),
  )
  if (asset.status !== 200 && asset.status !== 304)
    throw new Error(`top page asset answered ${asset.status}`)
  const response = member
    ? new Response(markViewer(await asset.text(), viewer), asset)
    : new Response(asset.body, asset)
  if (member)
    for (const name of ['Content-Length', 'Content-Encoding', 'ETag'])
      response.headers.delete(name)
  response.headers.set(
    'Content-Security-Policy',
    homePagePolicy(contentBaseOf(c.env)),
  )
  // A page marked for a visitor is for that visitor alone.
  response.headers.set(
    'Cache-Control',
    member ? 'private, no-cache' : 'no-cache',
  )
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set(
    'Link',
    alternateLinks(c.env.PUBLIC_ORIGIN, new URL(c.req.url)),
  )
  return response
})

/** The recent public decks the top page fetches after it loads. */
homeRoutes.get('/api/public/slides', async (c) => {
  const page = parseDeckPage(c.req.query(), RECENT_DECKS_SHOWN)
  if (!page) return c.json({ error: 'bad page' }, 400)
  const owner = await currentOwner(c, { allowSuspended: true })
  const decks = await listPublicDecks(c.env.DB, {
    limit: page.limit,
    viewer: owner?.userId ?? null,
    after: page.after,
  })
  c.header('Cache-Control', owner ? 'private, no-store' : 'public, max-age=60')
  c.header('Vary', 'Cookie', { append: true })
  const base = contentBaseOf(c.env)
  const citedBy = await readCitedCounts(
    c.env.DB,
    decks.map((deck) => deck.handle),
    owner?.userId ?? null,
  )
  return c.json(
    decks.map((deck) =>
      toRecentDeck(deck, base, citedBy.get(citedKey(deck.handle, deck.slug))),
    ),
  )
})

/**
 * The newest communities the top page fetches after it loads (F30-AC48).
 * Every visitor gets the same list, whoever made them, so a shared cache
 * may keep it for a minute.
 */
homeRoutes.get('/api/public/communities', async (c) => {
  const page = parseCommunityPage(c.req.query(), HOME_NEW_COMMUNITIES_SHOWN)
  if (!page) return c.json({ error: 'bad page' }, 400)
  const shown = await listNewCommunities(c.env.DB, {
    limit: page.limit,
    offset: 0,
    after: page.after,
  })
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(shown.map(toHomeCommunityCard))
})

/**
 * What the top page shows a signed-in visitor: the new slides of the people
 * they follow. The page is a static file, so it
 * asks after it loads. The answer is one person's, and no cache keeps it;
 * a request without a session is answered with nothing.
 */
homeRoutes.get('/api/home', async (c) => {
  c.header('Cache-Control', 'private, no-store')
  c.header('Vary', 'Cookie', { append: true })
  const page = parseDeckPage(c.req.query(), HOME_FOLLOWING_SHOWN)
  if (!page) return c.json({ error: 'bad page' }, 400)
  const owner = await currentOwner(c)
  if (!owner) return c.json(null)
  const following = await listPublicDecks(c.env.DB, {
    limit: page.limit,
    viewer: owner.userId,
    followedBy: owner.userId,
    after: page.after,
  })
  const citedBy = await readCitedCounts(
    c.env.DB,
    following.map((deck) => deck.handle),
    owner.userId,
  )
  return c.json(toHomeLists(following, contentBaseOf(c.env), citedBy))
})

/**
 * What the top page shows a signed-in visitor of the communities they
 * follow (F31-AC3): the newest public slides in them, as the people's are
 * asked for above. Null for a request without a session, and for a visitor
 * who follows no community, whose page holds no room for them (F31-AC6).
 */
homeRoutes.get('/api/home/communities', async (c) => {
  c.header('Cache-Control', 'private, no-store')
  c.header('Vary', 'Cookie', { append: true })
  const page = parseDeckPage(c.req.query(), HOME_COMMUNITIES_SHOWN)
  if (!page) return c.json({ error: 'bad page' }, 400)
  const owner = await currentOwner(c)
  if (!owner || !(await followsAnyCommunity(c.env.DB, owner.userId)))
    return c.json(null)
  const talks = await listFollowedCommunityTalks(c.env.DB, {
    viewer: owner.userId,
    limit: page.limit,
    offset: 0,
    after: page.after,
  })
  const citedBy = await readCitedCounts(
    c.env.DB,
    talks.map((talk) => talk.handle),
    owner.userId,
  )
  return c.json(toHomeCommunities(talks, contentBaseOf(c.env), citedBy))
})
