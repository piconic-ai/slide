import { Hono } from 'hono'
import { currentOwner } from '../auth/owner-middleware'
import { homePagePolicy } from '../decks/pages'
import { listOwnDecks } from '../decks/own-decks-store'
import { contentBaseOf } from '../preview/config'
import { RECENT_DECKS_SHOWN } from '../share/list-pages'
import { toRecentDeck } from '../share/recent'
import { listPublicDecks } from '../share/store'
import { HOME_ASSET_PATHS } from './home-assets'
import { toHomeLists } from './home-lists'
import { HOME_FOLLOWING_SHOWN } from './home-shape'
import { alternateLinks } from './i18n'
import { langOf } from './lang'

/** Request headers that let Static Assets answer 304 for the top page. */
const CONDITIONAL_HEADERS = ['If-None-Match', 'If-Modified-Since'] as const

export const homeRoutes = new Hono<{ Bindings: Env }>()

/**
 * The top page is built ahead of time, one file per language. It is served
 * here rather than straight from Static Assets so it carries the page
 * headers; it reads no D1. Each file has its own ETag, so a page seen in
 * one language is not revalidated as the other.
 */
homeRoutes.get('/', async (c) => {
  const headers = new Headers()
  for (const name of CONDITIONAL_HEADERS) {
    const value = c.req.header(name)
    if (value) headers.set(name, value)
  }
  const asset = await c.env.ASSETS.fetch(
    new Request(new URL(HOME_ASSET_PATHS[langOf(c)], c.req.url), { headers }),
  )
  if (asset.status !== 200 && asset.status !== 304)
    throw new Error(`top page asset answered ${asset.status}`)
  const response = new Response(asset.body, asset)
  response.headers.set(
    'Content-Security-Policy',
    homePagePolicy(contentBaseOf(c.env)),
  )
  response.headers.set('Cache-Control', 'no-cache')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set(
    'Link',
    alternateLinks(c.env.PUBLIC_ORIGIN, new URL(c.req.url)),
  )
  return response
})

/** The recent public decks the top page fetches after it loads. */
homeRoutes.get('/api/public/slides', async (c) => {
  const owner = await currentOwner(c, { allowSuspended: true })
  const decks = await listPublicDecks(c.env.DB, {
    limit: RECENT_DECKS_SHOWN,
    viewer: owner?.userId ?? null,
  })
  c.header('Cache-Control', owner ? 'private, no-store' : 'public, max-age=60')
  c.header('Vary', 'Cookie', { append: true })
  const base = contentBaseOf(c.env)
  return c.json(decks.map((deck) => toRecentDeck(deck, base)))
})

/**
 * What the top page shows a signed-in visitor: their own slides, and the
 * new slides of the people they follow. The page is a static file, so it
 * asks after it loads. The answer is one person's, and no cache keeps it;
 * a request without a session is answered with nothing.
 */
homeRoutes.get('/api/home', async (c) => {
  c.header('Cache-Control', 'private, no-store')
  c.header('Vary', 'Cookie', { append: true })
  const owner = await currentOwner(c)
  if (!owner) return c.json(null)
  const [own, following] = await Promise.all([
    listOwnDecks(c.env.DB, owner.userId),
    listPublicDecks(c.env.DB, {
      limit: HOME_FOLLOWING_SHOWN,
      viewer: owner.userId,
      followedBy: owner.userId,
    }),
  ])
  return c.json(toHomeLists(own, following, contentBaseOf(c.env)))
})
