import { openTestBrowser } from '../test-open-browser'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import type { Browser, Page } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { followCommunity, unfollowCommunity } from '../communities/follow-store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from '../communities/test-communities'
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
import { HOME_MORE_STEP } from './home-more'

// The page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const env = testEnv(platform.env)
const BOB = '2'

let browser: Browser
let owner = ''
beforeAll(async () => {
  await applyMigrations(database)
  browser = await openTestBrowser()
}, 60_000)
beforeEach(async () => {
  await resetTables(database)
  await resetCommunities(database)
  // Signing in records the handle "owner", who owns the seeded slides.
  owner = await signIn(env)
  await signIn(env, 'bob', { id: BOB })
}, 60_000)
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
}, 60_000)

type Options = {
  cookie?: string
  /** How many requests for more cards fail before they are answered. */
  failMore?: number
}

/** Opens the top page, answering its requests with the Worker. */
async function openTop(options: Options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  let failures = options.failMore ?? 0
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    if (url.searchParams.has('at') && failures > 0) {
      failures--
      return route.fulfill({ status: 500, body: '{}' })
    }
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
  await page.goto(`${TEST_ORIGIN}/`)
  await page.locator('.recent-list:not(.recent-loading)').waitFor()
  return page
}

const panel = (page: Page) => page.locator('[role="tabpanel"]:visible')
const moreButton = (page: Page) =>
  panel(page).getByRole('button', { name: 'もっと見る' })
const cardCount = (page: Page, cards: string) =>
  panel(page).locator(`${cards}:not(.home-spare)`).count()

async function seedDecks(count: number, ownerId = OWNER_ID, from = 100) {
  for (let index = 0; index < count; index++)
    await seedPublic(
      database,
      `deck-${ownerId}-${index}`,
      from + index,
      `Talk ${index}`,
      ownerId,
    )
}

test('F03-AC162, F03-AC164: Given twelve public slides, When "show more" is pressed, Then the other four go under the eight, the eight do not move, and nothing more is offered', async () => {
  await seedDecks(12)
  const page = await openTop()
  expect(await cardCount(page, '.deck-card')).toBe(8)
  // Where the first card stands on the page; pressing scrolls the window.
  const first = () =>
    panel(page)
      .locator('.deck-card')
      .first()
      .evaluate((card) => {
        const box = card.getBoundingClientRect()
        return [box.left, box.top + window.scrollY]
      })
  const before = await first()
  await moreButton(page).click()
  await expect.poll(() => cardCount(page, '.deck-card')).toBe(12)
  expect(await first()).toEqual(before)
  expect(
    await panel(page).locator('.deck-card .deck-name').allTextContents(),
  ).toEqual(Array.from({ length: 12 }, (_, i) => `Talk ${11 - i}`))
  expect(await moreButton(page).count()).toBe(0)
  await page.close()
})

test.each([
  [8, false],
  [9, true],
])(
  'F03-AC164: Given %i public slides, When the top page opens, Then "show more" is offered only when more stand after the eight',
  async (count, offered) => {
    await seedDecks(count)
    const page = await openTop()
    expect(await moreButton(page).count()).toBe(offered ? 1 : 0)
    await page.close()
  },
)

test('F03-AC162: Given more slides than one press adds, When "show more" is pressed, Then it adds one hundred and offers more, and the next press adds the rest', async () => {
  await seedDecks(8 + HOME_MORE_STEP + 2)
  const page = await openTop()
  await moreButton(page).click()
  await expect
    .poll(() => cardCount(page, '.deck-card'))
    .toBe(8 + HOME_MORE_STEP)
  expect(await moreButton(page).count()).toBe(1)
  await moreButton(page).click()
  await expect
    .poll(() => cardCount(page, '.deck-card'))
    .toBe(8 + HOME_MORE_STEP + 2)
  expect(await moreButton(page).count()).toBe(0)
  await page.close()
}, 120_000)

test('F03-AC163: Given ten slides shown eight, When a new slide is published and then "show more" is pressed, Then the last two come once each, and the new one does not slip in', async () => {
  await seedDecks(10)
  const page = await openTop()
  await seedPublic(database, 'fresh', 999, 'Fresh talk')
  await moreButton(page).click()
  await expect.poll(() => cardCount(page, '.deck-card')).toBe(10)
  const names = await panel(page)
    .locator('.deck-card .deck-name')
    .allTextContents()
  expect(names.slice(8)).toEqual(['Talk 1', 'Talk 0'])
  expect(new Set(names).size).toBe(10)
  expect(names).not.toContain('Fresh talk')
  await page.close()
})

test('F03-AC165: Given the next slides fail to load once, When "show more" is pressed, Then the eight stay with a note and a button to ask again, which brings the rest', async () => {
  await seedDecks(10)
  const page = await openTop({ failMore: 1 })
  await moreButton(page).click()
  const note = panel(page).locator('.home-more-note')
  await note.waitFor()
  expect(await note.locator('p').textContent()).toBe(
    '続きを読み込めませんでした。',
  )
  expect(await cardCount(page, '.deck-card')).toBe(8)
  expect(await moreButton(page).count()).toBe(0)
  await note.getByRole('button', { name: 'もう一度読み込む' }).click()
  await expect.poll(() => cardCount(page, '.deck-card')).toBe(10)
  expect(await note.count()).toBe(0)
  await page.close()
})

test('F03-AC166: Given cards added by "show more", When another tab is chosen and recent slides again, Then the list starts over from its first eight', async () => {
  await seedDecks(10)
  const page = await openTop()
  await moreButton(page).click()
  await expect.poll(() => cardCount(page, '.deck-card')).toBe(10)
  await page.getByRole('tab', { name: 'フォロー', exact: true }).click()
  await page.getByRole('tab', { name: '最近のスライド', exact: true }).click()
  await expect.poll(() => cardCount(page, '.deck-card')).toBe(8)
  expect(await moreButton(page).count()).toBe(1)
  await page.close()
})

test('F03-AC162: Given eight communities, When "show more" is pressed in their tab, Then the other two go under the six', async () => {
  for (let id = 1; id <= 8; id++)
    await seedCommunity(database, {
      id,
      handle: `c${id}`,
      links: [`https://c${id}.connpass.com/`],
      now: 1000 + id,
    })
  const page = await openTop()
  await page
    .getByRole('tab', { name: '最近のコミュニティ', exact: true })
    .click()
  await panel(page).locator('.community-card a').first().waitFor()
  expect(await cardCount(page, '.community-card')).toBe(6)
  await moreButton(page).click()
  await expect.poll(() => cardCount(page, '.community-card')).toBe(8)
  expect(
    await panel(page).locator('.community-card a').last().getAttribute('href'),
  ).toBe('/@c1')
  expect(await moreButton(page).count()).toBe(0)
  await page.close()
})

test('F03-AC162: Given ten slides of a followed person, When "show more" is pressed in the following tab, Then the other two go under the eight', async () => {
  await follow(database, { follower: OWNER_ID, followee: BOB, now: 1 })
  await seedDecks(10, BOB)
  const page = await openTop({ cookie: owner })
  await page.getByRole('tab', { name: 'フォロー', exact: true }).click()
  await panel(page).locator('.deck-card a').first().waitFor()
  expect(await cardCount(page, '.deck-card')).toBe(8)
  await moreButton(page).click()
  await expect.poll(() => cardCount(page, '.deck-card')).toBe(10)
  await page.close()
}, 30_000)

test('F03-AC162: Given ten slides in a followed community, When "show more" is pressed in its tab, Then the other two go under the eight', async () => {
  await seedCommunity(database, {
    id: 61,
    handle: 'kanagawapm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
  await unfollowCommunity(database, { userId: OWNER_ID, communityId: 61 })
  await followCommunity(database, { userId: OWNER_ID, communityId: 61, now: 1 })
  for (let index = 0; index < 10; index++) {
    await seedPublic(database, `t${index}`, 100 + index, `Talk ${index}`, BOB)
    await seedTalkLink(database, {
      deckId: `t${index}`,
      owner: BOB,
      url: `https://kanagawapm.connpass.com/event/${index + 1}/`,
    })
  }
  const page = await openTop({ cookie: owner })
  await page
    .getByRole('tab', { name: 'フォローコミュニティ', exact: true })
    .click()
  await panel(page).locator('.deck-card a').first().waitFor()
  expect(await cardCount(page, '.deck-card')).toBe(8)
  await moreButton(page).click()
  await expect.poll(() => cardCount(page, '.deck-card')).toBe(10)
  await page.close()
}, 30_000)
