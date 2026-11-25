import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { japaneseOutside } from './test-japanese'

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
  // Signing in records the handle "owner".
  await signIn(env)
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

async function openTop({ locale = 'ja-JP', failFirstList = false } = {}) {
  const page = await browser.newPage({ locale })
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    if (failFirstList && url.pathname === '/api/public/slides') {
      failFirstList = false
      return route.fulfill({ status: 500, body: 'error' })
    }
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
  page
    .locator('.recent-list .deck-card:not(.home-spare) .deck-name')
    .allTextContents()

test('Given public decks, When an English reader opens the top page and switches to Japanese, Then the grid loads under the page CSP in the chosen language', async () => {
  await seedPublic(db, 'old', 100, 'Old talk')
  await seedPublic(db, 'new', 200, '<b>New</b> talk')
  const { page, errors } = await openTop({ locale: 'en-US' })
  await page.locator('.recent-list:not(.recent-loading)').waitFor()
  expect(await titles(page)).toEqual(['<b>New</b> talk', 'Old talk'])
  expect(
    await page
      .locator('.recent-list a.card-title')
      .first()
      .getAttribute('href'),
  ).toBe('/@owner/new')
  expect(
    await page
      .locator('.recent-list .card-meta a')
      .first()
      .getAttribute('href'),
  ).toBe('/@owner')
  expect(await page.locator('.recent-loading').count()).toBe(0)
  const date = page.locator('.recent-list time').first()
  expect(await page.locator('html').getAttribute('lang')).toBe('en')
  expect(await date.textContent()).toBe('Jan 1, 1970')
  expect(japaneseOutside(await page.content())).toEqual([])
  expect(errors).toEqual([])

  await page.getByRole('link', { name: '日本語' }).click()
  await page.waitForURL(`${TEST_ORIGIN}/?lang=ja`)
  expect(await page.locator('html').getAttribute('lang')).toBe('ja')
  await page.goto(`${TEST_ORIGIN}/`)
  expect(await page.locator('html').getAttribute('lang')).toBe('ja')
  await expect.poll(() => date.textContent()).toBe('1970年1月1日')
  expect(errors).toEqual([])
  await page.close()
})

test.each([
  [
    'ja-JP',
    '最近のスライド',
    '最近のスライドを読み込めませんでした。',
    'もう一度読み込む',
    '公開されたスライドは、まだありません。',
  ],
  [
    'en-US',
    'Recent slides',
    'Could not load recent slides.',
    'Try again',
    'No slide is public yet.',
  ],
])(
  'F03-AC83: Given a failed list request in %s, When the reader retries, Then the empty list replaces the failure in their language',
  async (locale, heading, failure, retry, empty) => {
    const { page } = await openTop({ locale, failFirstList: true })
    const note = page.locator('.recent-body [role="status"]')
    await note.getByText(failure).waitFor()
    expect(await page.getByRole('heading', { name: heading }).count()).toBe(1)
    expect(await page.locator('.recent-loading').count()).toBe(0)
    if (locale === 'en-US')
      expect(japaneseOutside(await page.content())).toEqual([])
    const [response] = await Promise.all([
      page.waitForResponse(`${TEST_ORIGIN}/api/public/slides`),
      note.getByRole('button', { name: retry }).click(),
    ])
    expect(response.status()).toBe(200)
    await expect.poll(() => note.textContent()).toBe(empty)
    expect(await note.getByRole('button').count()).toBe(0)
    expect(await page.getByRole('heading', { name: heading }).count()).toBe(1)
    expect(await page.locator('.recent-loading').count()).toBe(0)
    expect(await page.locator('.recent-list .home-spare').count()).toBe(8)
    if (locale === 'en-US')
      expect(japaneseOutside(await page.content())).toEqual([])
    await page.close()
  },
)

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

test('Given the top page as built, When it opens, Then the place to drop slides is shown and its script makes the button usable', async () => {
  const { page } = await openTop()
  const frame = page.locator('[data-drop-zone="new"]')
  expect(await frame.getByText('スライドをここにドロップ').count()).toBe(1)
  const button = frame.getByRole('button', { name: 'ファイルを選ぶ' })
  await expect.poll(() => button.isEnabled()).toBe(true)
  expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await page.close()
})

test('Given a browser that runs no script, When the top page opens, Then the place to drop slides and the way in show, and no heading or placeholder of a list that will never come', async () => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    const response = await server.fetch(new Request(url), env)
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}/`)
  expect(await page.locator('[data-drop-zone="new"]').isVisible()).toBe(true)
  expect(await page.getByRole('link', { name: 'ログイン' }).isVisible()).toBe(
    true,
  )
  expect(await page.locator('#recent').isVisible()).toBe(false)
  expect(await page.locator('.recent-loading').isVisible()).toBe(false)
  await context.close()
})

test('Given a file dragged over or dropped on the place to drop slides, When its script is ready, Then the browser does not leave the page to open the file', async () => {
  const { page } = await openTop()
  await expect
    .poll(() =>
      page.locator('[data-drop-zone="new"] [data-drop-choose]').isEnabled(),
    )
    .toBe(true)
  const prevented = await page.evaluate(() =>
    ['dragover', 'drop'].map((type) => {
      const event = new DragEvent(type, { bubbles: true, cancelable: true })
      document.querySelector('[data-drop-zone="new"] p')?.dispatchEvent(event)
      return event.defaultPrevented
    }),
  )
  expect(prevented).toEqual([true, true])
  // Elsewhere on the page the browser keeps its own behaviour.
  expect(
    await page.evaluate(() => {
      const event = new DragEvent('drop', { bubbles: true, cancelable: true })
      document.querySelector('footer')?.dispatchEvent(event)
      return event.defaultPrevented
    }),
  ).toBe(false)
  await page.close()
})
