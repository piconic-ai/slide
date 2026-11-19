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
    if (api && url.pathname === '/api/public/slides') return api(route)
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
  page.locator('.recent-list .deck-name').allTextContents()

test('Given public decks, When the static top page opens, Then the grid fetches and shows them under the page CSP', async () => {
  await seedPublic(db, 'old', 100, 'Old talk')
  await seedPublic(db, 'new', 200, '<b>New</b> talk')
  const { page, errors } = await openTop()
  await page.locator('.recent-list:not(.recent-loading)').waitFor()
  expect(await titles(page)).toEqual(['<b>New</b> talk', 'Old talk'])
  expect(
    await page
      .locator('.recent-list a.card-title')
      .first()
      .getAttribute('href'),
  ).toBe('/@owner/new')
  expect(await page.locator('.recent-loading').count()).toBe(0)
  // Readers see the day as their language writes it, not ISO 8601.
  expect(await page.locator('.recent-list time').first().textContent()).toBe(
    '1970年1月1日',
  )
  // A CSP refusal of the script or the fetch would be logged here.
  expect(errors).toEqual([])
  await page.close()
})

test('Given no public decks, When the list arrives, Then the section is left out, heading and all', async () => {
  const { page } = await openTop((route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await expect.poll(() => page.locator('.recent-loading').count()).toBe(0)
  expect(
    await page.getByRole('heading', { name: '最近のスライド' }).count(),
  ).toBe(0)
  await page.close()
})

test('Given the list request fails, When it settles, Then a message replaces the placeholders under the heading', async () => {
  const { page } = await openTop((route) =>
    route.fulfill({ status: 500, body: 'error' }),
  )
  await page.getByText('最近のスライドを読み込めませんでした。').waitFor()
  expect(await page.locator('.recent-loading').count()).toBe(0)
  expect(
    await page.getByRole('heading', { name: '最近のスライド' }).count(),
  ).toBe(1)
  await page.close()
})

test.each([1280, 375])(
  'F03-AC11: Given ten public decks and a %ipx screen, When the top page settles, Then the cards wrap into a grid and nothing runs past the screen',
  async (width) => {
    for (let index = 0; index < 10; index++)
      await seedPublic(
        db,
        `deck-${index}`,
        100 + index,
        `Talk number ${index} with a rather long title`,
      )
    const { page } = await openTop()
    await page.setViewportSize({ width, height: 800 })
    await page.locator('.recent-list:not(.recent-loading)').waitFor()
    const measured = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      lefts: [
        ...new Set(
          [...document.querySelectorAll('.recent-list .deck-card')].map(
            (card) => Math.round(card.getBoundingClientRect().left),
          ),
        ),
      ].length,
      cards: document.querySelectorAll('.recent-list .deck-card').length,
    }))
    expect(measured.scrollWidth).toBeLessThanOrEqual(width)
    // Two columns on a phone, four on a wide screen; eight cards in rows.
    expect(measured.lefts).toBe(width === 375 ? 2 : 4)
    expect(measured.cards).toBe(8)
    await page.close()
  },
)

test('Given the top page as built, When it opens, Then the place to drop slides is shown and its button cannot be pressed yet', async () => {
  const { page } = await openTop()
  const frame = page.locator('[data-drop-zone="new"]')
  expect(await frame.getByText('スライドをここにドロップ').count()).toBe(1)
  const button = frame.getByRole('button', { name: 'ファイルを選ぶ' })
  expect(await button.isDisabled()).toBe(true)
  expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await page.close()
})
