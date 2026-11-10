import { Hono } from 'hono'
import { HOME_PAGE_POLICY } from '../decks/pages'
import { RECENT_DECKS_SHOWN } from '../share/list-pages'
import { toRecentDeck } from '../share/recent'
import { listPublicDecks } from '../share/store'
import { HOME_ASSET_PATHS } from './home-assets'
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
  response.headers.set('Content-Security-Policy', HOME_PAGE_POLICY)
  response.headers.set('Cache-Control', 'no-cache')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
})

/** The recent public decks the top page fetches after it loads. */
homeRoutes.get('/api/public/decks', async (c) => {
  const decks = await listPublicDecks(c.env.DB, { limit: RECENT_DECKS_SHOWN })
  // Shared briefly: a new deck may take a minute to appear on the top page.
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(decks.map(toRecentDeck))
})
