import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { TEST_ORIGIN, testEnv } from '../publication/test-support'

// The page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
// A session cookie is looked up before the page is marked for it.
beforeAll(() => applyMigrations(platform.env.DB))
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
  // No explanation: the page begins with the place to drop slides, whose
  // title is the page's one h1, then the row of tabs, then the panel of
  // recent slides.
  expect(page.match(/<h1[\s>]/g)).toHaveLength(1)
  expect(page).toMatch(
    /<h1[^>]*data-drop-title[^>]*>\s*スライドをここにドロップ/,
  )
  const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'))
  const order = [
    'data-drop-zone="new"',
    'role="tablist"',
    'id="home-tab-recent-panel"',
  ].map((part) => main.indexOf(part))
  expect(order.every((at) => at > -1)).toBe(true)
  expect(order).toEqual([...order].sort((a, b) => a - b))
  expect(main).toContain('スライドをここにドロップ')
  expect(main).toContain(
    '共有用の URL ができます。HTML、zip に対応。公開するまでは自分だけが見られます。',
  )
  // The frame cannot take a file yet, and says so by being disabled.
  expect(main).toMatch(/<button[^>]*disabled[^>]*>ファイルを選ぶ<\/button>/)
  // The lists are filled in after the page loads, under one row of tabs.
  expect(main).toMatch(/<div class="home-list home-tabs"/)
  expect(main).not.toContain('自分のスライド')
  expect(main).toMatch(/<div class="page page-wide home" data-member="no"/)
  // Without scripts the lists never come, so the tabs and their
  // placeholders are hidden.
  expect(page).toMatch(
    /<noscript>\s*<style>\.home-list \{ display: none; \}<\/style>\s*<\/noscript>/,
  )
  // The first scope uses no colour block and no cut-paper shape.
  expect(page).not.toMatch(/class="[^"]*(color-block|block-shape)/)
  for (const gone of ['id="touch"', 'id="learn"', 'id="gather"', 'mock-slide'])
    expect(page).not.toContain(gone)
})

test('Given the built top page, When it is opened, Then the list is a placeholder that its component script replaces', async () => {
  const page = await (await get()).text()
  expect(page).toMatch(/bf-s="HomeTabs_[^"]+"/)
  expect(page).toContain(
    'class="deck-grid deck-grid-4 recent-list recent-loading"',
  )
  expect(page).toMatch(
    /<script type="module" src="\/components\/assets\/components\/HomeTabs\.tsx-[^"]+\.js">/,
  )
  // No deck is baked in at build time.
  expect(page).not.toContain('<a class="card-title"')
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

const OWNER_COOKIE_HEADER = { Cookie: '__Host-slide_owner=anything' }

test('F21-AC53, F03-AC81: Given a visitor with no session cookie, When the top page is requested, Then it is the file as built, marked for no one, and kept apart by Cookie', async () => {
  const response = await get()
  const page = await response.text()
  // The mark a member's copy replaces is in the file once, and only there.
  expect(page.split('data-member="no"')).toHaveLength(2)
  expect(response.headers.get('Vary')).toContain('Cookie')
})

test('Given a visitor with a session cookie, When the top page is requested, Then it is marked as theirs, without the ETag of the file for everyone, and 304 is never answered', async () => {
  const etag = (await get()).headers.get('ETag') ?? ''
  const response = await get({ ...OWNER_COOKIE_HEADER, 'If-None-Match': etag })
  expect(response.status).toBe(200)
  const page = await response.text()
  expect(page).toContain('data-member="yes"')
  expect(page).not.toContain('data-member="no"')
  expect(response.headers.get('ETag')).toBeNull()
  expect(response.headers.get('Cache-Control')).toContain('private, no-cache')
  expect(response.headers.get('Vary')).toContain('Cookie')
  expect(response.headers.get('Content-Security-Policy')).toContain(
    "connect-src 'self'",
  )
})
