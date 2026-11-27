import { openTestBrowser } from '../test-open-browser'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { accounts } from '../db/schema'
import { drizzle } from 'drizzle-orm/d1'
import { applyMigrations } from '../db/test-migrations'
import { follow } from '../follows/store'
import {
  OWNER_ID,
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

// The page is public/index.html from `pnpm build`; CI builds before testing.
// The delivery origin of the slides is a stand-in here (below): that the real
// slides turn inside a card is checked with verify-slide, not by this file.
const engineName = process.env.BROWSER ?? 'chromium'
const engine = { chromium, webkit, firefox }[engineName]
if (!engine) throw new Error(`Unknown BROWSER: ${engineName}`)

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
const BOB = '2'

/** Slides that count pages, as the embed's own browser tests do. */
const STAND_IN = `<!doctype html><title>Deck</title><h1 id="page">1</h1>
<script>
  const show = (n) => (document.querySelector('#page').textContent = n)
  let page = 1
  addEventListener('keydown', (e) => e.key === 'ArrowRight' && show(++page))
</script>`

let browser: Browser
let owner = ''
beforeAll(async () => {
  await applyMigrations(database)
  browser = await openTestBrowser(engine)
}, 60_000)
beforeEach(async () => {
  await resetTables(database)
  owner = await signIn(env)
  await drizzle(database)
    .insert(accounts)
    .values({ user_id: BOB, handle: 'bob', created_at: 2 })
}, 60_000)
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
}, 60_000)

type Options = { cookie?: string; width?: number; english?: boolean }

/** Opens the top page; the Worker answers the service, a stand-in the slides. */
async function openTop(options: Options = {}) {
  const page = await browser.newPage({
    viewport: { width: options.width ?? 1280, height: 900 },
    locale: options.english ? 'en-US' : 'ja-JP',
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname.endsWith('.content.example'))
      return route.fulfill({ contentType: 'text/html', body: STAND_IN })
    if (url.origin !== TEST_ORIGIN) return route.abort()
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
  await page.goto(`${TEST_ORIGIN}/${options.english ? '?lang=en' : ''}`)
  await page
    .locator('.timeline-list:not(.timeline-loading), .home-timeline-note')
    .first()
    .waitFor()
  return page
}

const POLL = { timeout: 10_000 }
const panel = (page: Page) => page.locator('[role="tabpanel"]:visible')
const frames = (page: Page) => page.locator('.card-frame')
const covers = (page: Page) => panel(page).locator('.card-cover-play')

/** Where a card's title, author and link to the viewer are. */
const placeOf = (page: Page, card = 0) =>
  panel(page)
    .locator('.timeline-card')
    .nth(card)
    .evaluate((element) =>
      ['.timeline-card-title', '.card-meta a', '.icon-link', '.card-cover'].map(
        (selector) => {
          const box = element.querySelector(selector)!.getBoundingClientRect()
          return [box.x, box.y + window.scrollY, box.width, box.height]
        },
      ),
    )

async function seedTalks(count: number) {
  for (let index = 0; index < count; index++)
    await seedPublic(
      database,
      `talk-${index}`,
      100 + index,
      `Talk ${index}`,
      OWNER_ID,
    )
}

/** The slides are turned on in the card: the frame is shown and holds the deck. */
const shown = (page: Page, card = 0) =>
  panel(page)
    .locator('.timeline-card')
    .nth(card)
    .locator('.card-frame-shown')
    .waitFor(POLL)

test('F44-AC27: Given a card, When its cover is pressed, Then the card turns into the compact embed of its slides, framed in the cover’s place, and the title, author and link to the viewer do not move', async () => {
  await seedTalks(2)
  const page = await openTop()
  const before = await placeOf(page)
  await covers(page).first().click()
  await shown(page)
  const frame = frames(page)
  expect(await frame.count()).toBe(1)
  // The newest card is the last seeded: its viewer, with the compact shape.
  expect(await frame.getAttribute('src')).toBe('/embed/@owner/talk-1?t=compact')
  expect(await frame.getAttribute('title')).toBe('Talk 1')
  expect(await placeOf(page)).toEqual(before)
  // The frame lies exactly over the cover.
  const [cover, over] = await Promise.all([
    panel(page)
      .locator('.timeline-card')
      .first()
      .locator('.card-cover')
      .boundingBox(),
    frame.boundingBox(),
  ])
  expect(over).toEqual(cover)
  // The slides are the compact embed: no line of its own under them, and
  // they turn.
  const inside = page.frameLocator('.card-frame')
  await inside.locator('iframe#deck').waitFor(POLL)
  expect(await inside.locator('.embed-line').count()).toBe(0)
  await page.close()
})

test.each([['Enter'], ['Space']])(
  'F44-AC27: Given the cover chosen with the keyboard, When %s is pressed, Then the card turns into its slides and the keys reach them',
  async (key) => {
    await seedTalks(1)
    const page = await openTop()
    const cover = covers(page).first()
    // A button with a name that says what it does, and no link to follow.
    expect(await cover.evaluate((element) => element.tagName)).toBe('BUTTON')
    expect(await cover.getAttribute('aria-label')).toBe(
      'Talk 0 を、ここでめくる',
    )
    await cover.focus()
    await page.keyboard.press(key === 'Space' ? ' ' : key)
    await shown(page)
    // The focus is in the card's slides, so the arrow keys turn them.
    expect(
      await page.evaluate(() => document.activeElement?.className),
    ).toContain('card-frame')
    expect(page.url()).toBe(`${TEST_ORIGIN}/`)
    await page.close()
  },
)

test('F44-AC27: Given the page in English, When a cover is read, Then its name is in English', async () => {
  await seedTalks(1)
  const page = await openTop({ english: true })
  expect(await covers(page).first().getAttribute('aria-label')).toBe(
    'Page through Talk 0 here',
  )
  await page.close()
})

test('F44-AC27: Given a cover pressed several times in a row, When the frame loads, Then there is one frame and it is shown', async () => {
  await seedTalks(1)
  const page = await openTop()
  const cover = covers(page).first()
  for (let press = 0; press < 5; press++)
    await cover.click({ force: true, noWaitAfter: true }).catch(() => {})
  await shown(page)
  expect(await frames(page).count()).toBe(1)
  await page.close()
})

test('F44-AC28: Given a card turned into its slides, When another card is opened, Then the first goes back to its cover and one frame stays', async () => {
  await seedTalks(3)
  const page = await openTop()
  await covers(page).nth(0).click()
  await shown(page, 0)
  await covers(page).nth(1).click()
  await shown(page, 1)
  expect(await frames(page).count()).toBe(1)
  // The first card has its cover back, and it can be opened again.
  const first = panel(page).locator('.timeline-card').nth(0)
  expect(await first.locator('.card-frame').count()).toBe(0)
  expect(await first.locator('.card-cover-play').isDisabled()).toBe(false)
  await covers(page).nth(0).click()
  await shown(page, 0)
  expect(await frames(page).count()).toBe(1)
  expect(
    await panel(page)
      .locator('.timeline-card')
      .nth(1)
      .locator('.card-frame')
      .count(),
  ).toBe(0)
  await page.close()
})

test('F44-AC28: Given a card turned into its slides, When it scrolls out of the screen, Then it goes back to its cover; and a card pressed just after is the one that stays', async () => {
  await seedTalks(12)
  const page = await openTop({ width: 375 })
  await covers(page).nth(0).click()
  await shown(page, 0)
  // Far away, to the last card: the first is out of the screen.
  await panel(page).locator('.timeline-card').last().scrollIntoViewIfNeeded()
  await expect.poll(() => frames(page).count(), POLL).toBe(0)
  const first = panel(page).locator('.timeline-card').first()
  expect(await first.locator('.card-cover-play').isDisabled()).toBe(false)
  // Pressed right after it left: the last card is the one turned.
  await covers(page).last().click()
  await shown(page, 11)
  expect(await frames(page).count()).toBe(1)
  // Bringing the first card back does not open it again.
  await first.scrollIntoViewIfNeeded()
  await expect.poll(() => frames(page).count(), POLL).toBe(0)
  expect(await frames(page).count()).toBe(0)
  await page.close()
})

test('F44-AC29: Given a slide that stopped being public after the list came, When its cover is pressed, Then the card stays on its cover', async () => {
  await seedTalks(2)
  const page = await openTop()
  await database
    .prepare(
      "UPDATE decks SET hidden_at = 1, hidden_reason = 'check', hidden_by = 'op' WHERE id = 'talk-1'",
    )
    .run()
  await covers(page).first().click()
  // The frame may appear for a moment; it is never shown and is taken away.
  await expect.poll(() => frames(page).count(), POLL).toBe(0)
  expect(await panel(page).locator('.card-frame-shown').count()).toBe(0)
  const cover = covers(page).first()
  expect(await cover.isDisabled()).toBe(false)
  expect(await cover.isVisible()).toBe(true)
  // The other slides still turn.
  await covers(page).nth(1).click()
  await shown(page, 1)
  await page.close()
})

test('F44-AC29: Given slides that were paused after the list came, When their cover is pressed, Then the card stays on its cover', async () => {
  await seedTalks(1)
  const page = await openTop()
  await database
    .prepare('UPDATE decks SET public_deployment_id = NULL WHERE id = ?')
    .bind('talk-0')
    .run()
  await covers(page).first().click()
  await expect.poll(() => frames(page).count(), POLL).toBe(0)
  expect(await panel(page).locator('.card-frame-shown').count()).toBe(0)
  await page.close()
})

test('F44-AC30: Given Alice follows Bob, When she opens "フォロー" and presses a cover, Then it turns as in "すべて", and the tab left sends it back', async () => {
  await seedPublic(database, 'bobs', 300, 'Bob’s', BOB)
  await follow(database, { follower: OWNER_ID, followee: BOB, now: 1 })
  const page = await openTop({ cookie: owner })
  await page.getByRole('tab', { name: 'フォロー' }).click()
  await panel(page).locator('.timeline-card').first().waitFor(POLL)
  const before = await placeOf(page)
  await covers(page).first().click()
  await shown(page)
  expect(await frames(page).getAttribute('src')).toBe(
    '/embed/@bob/bobs?t=compact',
  )
  expect(await placeOf(page)).toEqual(before)
  // Only one card of the page is turned, across the two tabs.
  await page.getByRole('tab', { name: 'すべて' }).click()
  await expect.poll(() => page.locator('.card-frame').count(), POLL).toBe(0)
  await page.close()
})
