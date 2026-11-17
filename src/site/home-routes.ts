import { Hono } from 'hono'
import { homePagePolicy } from '../decks/pages'
import { contentBaseOf } from '../preview/config'
import { RECENT_DECKS_SHOWN } from '../share/list-pages'
import { toRecentDeck } from '../share/recent'
import { listPublicDecks } from '../share/store'
import { HOME_ASSET_PATHS } from './home-assets'
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
  const decks = await listPublicDecks(c.env.DB, { limit: RECENT_DECKS_SHOWN })
  // Asked for again on every visit, like the profile list: a deck that is
  // paused, deleted, or hidden by an operator leaves the top page at once.
  c.header('Cache-Control', 'no-cache')
  const base = contentBaseOf(c.env)
  return c.json(decks.map((deck) => toRecentDeck(deck, base)))
})
