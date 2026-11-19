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
  // No heading and no explanation: the page begins with the place to drop
  // slides, then the visitor's own lists, then the recent slides.
  expect(page).not.toContain('<h1')
  const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'))
  const order = [
    'data-drop-zone="new"',
    'data-home-frame="own-slides"',
    'data-home-frame="following"',
    '<h2 id="recent"',
  ].map((part) => main.indexOf(part))
  expect(order.every((at) => at > -1)).toBe(true)
  expect(order).toEqual([...order].sort((a, b) => a - b))
  expect(main).toContain('スライドをここにドロップ')
  expect(main).toContain(
    '共有用の URL ができます。HTML、zip に対応。公開するまでは自分だけが見られます。',
  )
  // The frame cannot take a file yet, and says so by being disabled.
  expect(main).toMatch(/<button[^>]*disabled[^>]*>ファイルを選ぶ<\/button>/)
  // What a signed-in visitor sees is filled in after the page loads.
  expect(main).toMatch(/<section data-home-frame="own-slides" hidden(="")?>/)
  expect(main).toMatch(/<section data-home-frame="following" hidden(="")?>/)
  // The first scope uses no colour block and no cut-paper shape.
  expect(page).not.toMatch(/class="[^"]*(color-block|block-shape)/)
  for (const gone of ['id="touch"', 'id="learn"', 'id="gather"', 'mock-slide'])
    expect(page).not.toContain(gone)
})

test('Given the built top page, When it is opened, Then the list is a placeholder that its component script replaces', async () => {
  const page = await (await get()).text()
  expect(page).toMatch(/bf-s="RecentDecks_[^"]+"/)
  expect(page).toContain(
    'class="deck-grid deck-grid-4 recent-list recent-loading"',
  )
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
