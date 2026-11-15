import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import { signIn, TEST_ORIGIN, testEnv } from '../publication/test-support'

// The top page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
let browser: Browser
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

// Other browser tests run at the same time.
const SETTLE = { timeout: 10000 }

/**
 * A page of the service, with its requests answered by the Worker. The
 * session cookie is HttpOnly and host-bound, so it is added to each request
 * instead of the browser's jar. `session` answers /api/session in place of
 * the Worker when given; the returned options may be changed between loads.
 */
async function open(
  path: string,
  options: { cookie?: string; session?: 'fails' | 'waits' | 'refuses' } = {},
) {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    if (options.session === 'fails' && url.pathname === '/api/session')
      return route.abort()
    if (options.session === 'refuses' && url.pathname === '/api/session')
      return route.fulfill({ status: 429, body: 'Too many requests' })
    // Left unanswered: what the page shows meanwhile is from the last visit.
    if (options.session === 'waits' && url.pathname === '/api/session') return
    // Miniflare's local proxy refuses an Origin outside its own hostnames.
    const { origin: _origin, ...headers } = await route.request().allHeaders()
    if (options.cookie) headers.cookie = options.cookie
    const response = await server.fetch(new Request(url, { headers }), env)
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}${path}`)
  return { page, errors, options }
}

test.each([['/'], ['/start']])(
  'Given a visitor who is not signed in, When %s opens, Then the header shows the way in and the page allows the request',
  async (path) => {
    const { page, errors } = await open(path)
    const link = page.locator('.site-header [data-account] a')
    await expect.poll(() => link.textContent(), SETTLE).toBe('はじめる')
    expect(await link.getAttribute('href')).toBe('/start')
    expect(errors).toEqual([])
    await page.close()
  },
)

test.each([['/'], ['/decks']])(
  'Given a signed-in author, When %s opens, Then the header shows their icon leading to their decks',
  async (path) => {
    const cookie = await signIn(env, 'kobaken')
    const { page, errors } = await open(path, { cookie })
    const link = page.locator('.site-header [data-account] a.avatar')
    await expect.poll(() => link.count(), SETTLE).toBe(1)
    expect(await link.textContent()).toBe('k')
    expect(await link.getAttribute('href')).toBe('/decks')
    expect(await link.getAttribute('aria-label')).toBe('デッキ管理 (kobaken)')
    expect(errors).toEqual([])
    await page.close()
  },
)

test('Given the session cannot be asked, When the top page opens, Then the header falls back to the way in', async () => {
  const { page } = await open('/', { session: 'fails' })
  const link = page.locator('.site-header [data-account] a')
  await expect.poll(() => link.textContent(), SETTLE).toBe('はじめる')
  expect(await link.getAttribute('href')).toBe('/start')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.close()
})

test('Given a page as written, When no script has run, Then the header link is empty and the way in is offered without scripts', async () => {
  const page = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/start`), env)
  ).text()
  expect(page).toMatch(/<span[^>]*data-account[^>]*><\/span>/)
  expect(page).toContain('<noscript><a href="/start">はじめる</a></noscript>')
})

test('Given an author whose last visit was signed in, When the next page opens and the session has not answered yet, Then their icon is already shown', async () => {
  const cookie = await signIn(env, 'kobaken')
  const { page, options } = await open('/', { cookie })
  const link = page.locator('.site-header [data-account] a')
  await expect.poll(() => link.getAttribute('class'), SETTLE).toBe('avatar')

  options.session = 'waits'
  await page.goto(`${TEST_ORIGIN}/decks`, { waitUntil: 'domcontentloaded' })
  await expect.poll(() => link.getAttribute('href'), SETTLE).toBe('/decks')
  expect(await link.textContent()).toBe('k')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.close()
})

test('Given an author who signed out since their last visit, When the next page opens, Then the kept icon is replaced by the way in', async () => {
  const cookie = await signIn(env, 'kobaken')
  const { page, options } = await open('/', { cookie })
  const link = page.locator('.site-header [data-account] a')
  await expect.poll(() => link.getAttribute('class'), SETTLE).toBe('avatar')

  options.cookie = undefined
  await page.goto(`${TEST_ORIGIN}/`)
  await expect.poll(() => link.textContent(), SETTLE).toBe('はじめる')
  expect(await link.getAttribute('href')).toBe('/start')
  expect(await link.getAttribute('class')).toBe('')
  expect(await link.getAttribute('aria-label')).toBeNull()
  await page.close()
})

test('Given an author whose last visit was signed in, When the session refuses to answer, Then their icon stays', async () => {
  const cookie = await signIn(env, 'kobaken')
  const { page, options } = await open('/', { cookie })
  const link = page.locator('.site-header [data-account] a')
  await expect.poll(() => link.getAttribute('class'), SETTLE).toBe('avatar')

  options.session = 'refuses'
  const refused = page.waitForResponse((response) =>
    response.url().endsWith('/api/session'),
  )
  await page.goto(`${TEST_ORIGIN}/`)
  await refused
  await expect.poll(() => link.getAttribute('href'), SETTLE).toBe('/decks')
  expect(await link.getAttribute('class')).toBe('avatar')
  await page.close()
})
