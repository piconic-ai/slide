import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { TEST_ORIGIN, testEnv } from '../publication/test-support'

// The page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
afterAll(() => platform.dispose())

const get = (headers: Record<string, string> = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}/`, { headers }), env)

test('Given the built top page, When it is requested, Then the static file is served with the page headers', async () => {
  const response = await get()
  expect(response.status).toBe(200)
  const policy = response.headers.get('Content-Security-Policy') ?? ''
  expect(policy).toContain("script-src 'self'")
  expect(policy).toContain("connect-src 'self'")
  expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  const page = await response.text()
  // Hero, then the recent decks, then the feature sections.
  const hero = page.indexOf('<h1>さわって、わかる。</h1>')
  const recent = page.indexOf('<h2 id="recent">')
  const features = page.indexOf('<section id="touch"')
  expect(hero).toBeGreaterThan(-1)
  expect(recent).toBeGreaterThan(hero)
  expect(features).toBeGreaterThan(recent)
})

test('Given the built top page, When it is opened, Then the list is a placeholder that its component script replaces', async () => {
  const page = await (await get()).text()
  expect(page).toMatch(/bf-s="RecentDecks_[^"]+"/)
  expect(page).toContain('class="recent-list recent-loading"')
  expect(page).toMatch(
    /<script type="module" src="\/components\/assets\/components\/RecentDecks\.tsx-[^"]+\.js">/,
  )
  // No deck is baked in at build time.
  expect(page).not.toContain('class="card-title"')
})

test('Given the top page was seen, When it is revalidated with its ETag, Then it answers 304 with the page headers', async () => {
  const etag = (await get()).headers.get('ETag') ?? ''
  expect(etag).not.toBe('')
  const revalidated = await get({ 'If-None-Match': etag })
  expect(revalidated.status).toBe(304)
  expect(revalidated.headers.get('Content-Security-Policy')).toContain(
    "connect-src 'self'",
  )
  // Caches merge a 304's headers into the stored page, which stays indexable.
  expect(revalidated.headers.get('X-Robots-Tag')).toBeNull()
})
