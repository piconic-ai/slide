import { openTestBrowser } from '../test-open-browser'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import type { Browser, Page } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import {
  resetCommunities,
  seedCommunity,
} from '../communities/test-communities'
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
const database = platform.env.DB
const env = testEnv(platform.env)

let browser: Browser
beforeAll(async () => {
  await applyMigrations(database)
  browser = await openTestBrowser()
}, 60_000)
beforeEach(async () => {
  await resetTables(database)
  await resetCommunities(database)
  // Signing in records the handle "owner", who owns the seeded slides.
  await signIn(env)
}, 60_000)
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
}, 60_000)

/** Opens the top page for a visitor who is not signed in. */
async function openTop(width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    // Miniflare's local proxy refuses an Origin outside its own hostnames.
    const { origin: _origin, ...headers } = await route.request().allHeaders()
    const response = await server.fetch(new Request(url, { headers }), env)
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}/`)
  await page
    .locator('.recent-list:not(.recent-loading), .recent-body .home-room-empty')
    .first()
    .waitFor()
  return page
}

const chosen = (page: Page) =>
  page.getByRole('tab', { selected: true }).textContent()

const focused = (page: Page) =>
  page.evaluate(() => document.activeElement?.textContent ?? null)

test('F03-AC159: Given the top page, When a tab is chosen and the page is opened again, Then it opens on recent slides, and choosing changed no part of the URL', async () => {
  const page = await openTop()
  expect(await chosen(page)).toBe('最近のスライド')
  await page.getByRole('tab', { name: 'フォロー', exact: true }).click()
  expect(await chosen(page)).toBe('フォロー')
  expect(page.url()).toBe(`${TEST_ORIGIN}/`)
  await page.reload()
  await page.locator('[role="tab"][aria-selected="true"]').waitFor()
  expect(await chosen(page)).toBe('最近のスライド')
  await page.close()
})

test('F03-AC160: Given the tabs, When the arrow keys, Home and End are pressed, Then the focus and the choice move together, going round at either end, and only the chosen tab is in the tab order', async () => {
  const page = await openTop()
  await page.getByRole('tab', { selected: true }).focus()
  const steps: [key: string, tab: string][] = [
    ['ArrowRight', '最近のコミュニティ'],
    ['End', 'フォローコミュニティ'],
    ['ArrowRight', '最近のスライド'],
    ['ArrowLeft', 'フォローコミュニティ'],
    ['Home', '最近のスライド'],
  ]
  for (const [key, tab] of steps) {
    await page.keyboard.press(key)
    expect([key, await chosen(page), await focused(page)]).toEqual([
      key,
      tab,
      tab,
    ])
  }
  // Off the first tab, so the static page's own state cannot pass for it.
  await page.keyboard.press('End')
  expect(
    await page
      .getByRole('tab')
      .evaluateAll((tabs) => tabs.map((tab) => (tab as HTMLElement).tabIndex)),
  ).toEqual([-1, -1, -1, 0])
  // Only the chosen tab's panel shows, and it is named by its tab.
  const shown = page.locator('[role="tabpanel"]:visible')
  expect(await shown.count()).toBe(1)
  expect(await shown.getAttribute('aria-labelledby')).toBe(
    'home-tab-followed-communities',
  )
  for (const box of await page
    .getByRole('tab')
    .evaluateAll((tabs) =>
      tabs.map((tab) => tab.getBoundingClientRect().height),
    ))
    expect(box).toBeGreaterThanOrEqual(44)
  await page.close()
})

test('F03-AC161: Given ten public slides and eight communities, When the top page opens at 1280px, Then recent slides show eight in two rows of four, and recent communities six in two rows of three, newest first', async () => {
  for (let index = 0; index < 10; index++)
    await seedPublic(database, `deck-${index}`, 100 + index, `Talk ${index}`)
  for (let id = 1; id <= 8; id++)
    await seedCommunity(database, {
      id,
      handle: `c${id}`,
      links: [`https://c${id}.connpass.com/`],
      now: 1000 + id,
    })
  const page = await openTop()
  const grid = async (cards: string) =>
    page.locator(cards).evaluateAll((items) => {
      const boxes = items.map((item) => item.getBoundingClientRect())
      return {
        count: boxes.length,
        across: new Set(boxes.map((box) => Math.round(box.left))).size,
        rows: new Set(boxes.map((box) => Math.round(box.top))).size,
      }
    })
  expect(await grid('.recent-list .deck-card:not(.home-spare)')).toEqual({
    count: 8,
    across: 4,
    rows: 2,
  })
  expect(
    await page
      .locator('.recent-list .deck-card .deck-name')
      .first()
      .textContent(),
  ).toBe('Talk 9')
  await page
    .getByRole('tab', { name: '最近のコミュニティ', exact: true })
    .click()
  await page
    .locator('.home-new-communities .community-card a')
    .first()
    .waitFor()
  expect(
    await grid('.home-new-communities .community-card:not(.home-spare)'),
  ).toEqual({ count: 6, across: 3, rows: 2 })
  expect(
    await page
      .locator('.home-new-communities .community-card a')
      .first()
      .getAttribute('href'),
  ).toBe('/@c8')
  await page.close()
})

test('F03-AC171: Given a 375px screen, When each tab is chosen, Then the page never runs past the screen, the row of tabs alone slides sideways, the chosen tab stands in its view, and the cards stand one across', async () => {
  for (let index = 0; index < 3; index++)
    await seedPublic(database, `deck-${index}`, 100 + index, `Talk ${index}`)
  await seedCommunity(database, {
    id: 1,
    handle: 'c1',
    links: ['https://c1.connpass.com/'],
  })
  const page = await openTop(375)
  const row = page.locator('[role="tablist"]')
  expect(
    await row.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true)
  for (const name of [
    '最近のスライド',
    '最近のコミュニティ',
    'フォロー',
    'フォローコミュニティ',
  ]) {
    await page.getByRole('tab', { selected: true }).focus()
    // Reach the tab by the keyboard, which does not scroll on its own.
    while ((await chosen(page)) !== name)
      await page.keyboard.press('ArrowRight')
    const placed = await page.evaluate(() => {
      const tab = document.querySelector('[role="tab"][aria-selected="true"]')
      const list = document.querySelector('[role="tablist"]')
      if (!tab || !list) return null
      const a = tab.getBoundingClientRect()
      const b = list.getBoundingClientRect()
      return {
        inView: a.left >= b.left - 0.5 && a.right <= b.right + 0.5,
        scrollWidth: document.documentElement.scrollWidth,
      }
    })
    expect([name, placed]).toEqual([name, { inView: true, scrollWidth: 375 }])
  }
  await page.getByRole('tab', { name: '最近のスライド', exact: true }).click()
  expect(
    await page
      .locator('.recent-list .deck-card:not(.home-spare)')
      .evaluateAll(
        (cards) =>
          new Set(
            cards.map((card) => Math.round(card.getBoundingClientRect().left)),
          ).size,
      ),
  ).toBe(1)
  await page
    .getByRole('tab', { name: '最近のコミュニティ', exact: true })
    .click()
  await page
    .locator('.home-new-communities .community-card a')
    .first()
    .waitFor()
  expect(
    await page
      .locator('.home-new-communities .community-card:not(.home-spare)')
      .evaluateAll(
        (cards) =>
          new Set(
            cards.map((card) => Math.round(card.getBoundingClientRect().left)),
          ).size,
      ),
  ).toBe(1)
  await page.close()
})

test.each<{ width: number; narrow: boolean }>([
  { width: 375, narrow: true },
  { width: 1280, narrow: false },
])(
  'F03-AC178, F03-AC179: Given three public slides at $width px, When the recent slides came, Then on a narrow screen the footer comes right under them, and on a wide one the room of the first eight is kept',
  async ({ width, narrow }) => {
    await seedPublic(database, 'a', 100, 'One')
    await seedPublic(database, 'b', 101, 'Two')
    await seedPublic(database, 'c', 102, 'Three')
    const page = await openTop(width)
    const between = await page.evaluate(() => {
      const cards = [
        ...document.querySelectorAll(
          '.recent-list .deck-card:not(.home-spare)',
        ),
      ]
      const last = cards.at(-1)?.getBoundingClientRect().bottom ?? 0
      const footer = document
        .querySelector('.site-footer')
        ?.getBoundingClientRect().top
      return { count: cards.length, gap: Math.round((footer ?? 0) - last) }
    })
    expect(between.count).toBe(3)
    // Narrow: only the margins between the last card and the footer.
    if (narrow) expect(between.gap).toBeLessThanOrEqual(120)
    else expect(between.gap).toBeGreaterThanOrEqual(200)
    await page.close()
  },
)
