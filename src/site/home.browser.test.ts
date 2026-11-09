import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { chromium, type Browser, type Page, type Route } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

// The page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = testEnv(platform.env)

let browser: Browser
beforeAll(async () => {
  await applyMigrations(db)
  browser = await chromium.launch()
})
beforeEach(async () => {
  await resetTables(db)
  // Signing in records the handle "owner" from the stubbed GitHub login.
  await signIn(env)
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

/** Answers the page's requests with the Worker; `api` may replace the list. */
async function openTop(api?: (route: Route) => Promise<void>) {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    if (api && url.pathname === '/api/public/decks') return api(route)
    // Miniflare's local proxy refuses an Origin outside its own hostnames,
    // as DNS rebinding protection; module scripts send one. Deployed
    // Workers have no such check.
    const { origin: _origin, ...headers } = await route.request().allHeaders()
    const response = await server.fetch(new Request(url, { headers }), env)
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}/`)
  return { page, errors }
}

const titles = (page: Page) =>
  page.locator('.recent-list .card-title').allTextContents()

test('Given public decks, When the static top page opens, Then the carousel fetches and shows them under the page CSP', async () => {
  await seedPublic(db, 'old', 100, 'Old talk')
  await seedPublic(db, 'new', 200, '<b>New</b> talk')
  const { page, errors } = await openTop()
  await page.locator('.recent-list:not(.recent-loading)').waitFor()
  expect(await titles(page)).toEqual(['<b>New</b> talk', 'Old talk'])
  expect(
    await page.locator('.recent-cover a').first().getAttribute('href'),
  ).toBe('/@owner/new')
  expect(await page.locator('.recent-loading').count()).toBe(0)
  // A CSP refusal of the script or the fetch would be logged here.
  expect(errors).toEqual([])
  await page.close()
})

test('Given no public decks, When the top page opens, Then it says there are none yet', async () => {
  const { page } = await openTop()
  await page.getByText('まだ公開されたスライドはありません。').waitFor()
  expect(await page.locator('.recent-list').count()).toBe(0)
  await page.close()
})

test('Given the list request fails, When the top page opens, Then the placeholders give way to a message', async () => {
  const { page } = await openTop((route) =>
    route.fulfill({ status: 500, body: 'error' }),
  )
  await page.getByText('最近のスライドを読み込めませんでした。').waitFor()
  expect(await page.locator('.recent-loading').count()).toBe(0)
  await page.close()
})
