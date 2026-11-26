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
const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const env = testEnv(platform.env)
const BOB = '2'
const CAROL = '3'

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
  await drizzle(database)
    .insert(accounts)
    .values({ user_id: CAROL, handle: 'carol', created_at: 5 })
}, 60_000)
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
}, 60_000)

type Options = {
  cookie?: string
  width?: number
  /** How many requests for more cards fail before they are answered. */
  failMore?: number
}

/** Opens the top page, answering its requests with the Worker. */
async function openTop(options: Options = {}) {
  const page = await browser.newPage({
    viewport: { width: options.width ?? 1280, height: 900 },
  })
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
    const request =
      route.request().method() === 'GET'
        ? new Request(url, { headers })
        : new Request(url, {
            method: route.request().method(),
            headers: { ...headers, origin: TEST_ORIGIN },
            body: route.request().postData(),
          })
    const response = await server.fetch(request, env)
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}/`)
  await page
    .locator('.timeline-list:not(.timeline-loading), .home-timeline-note')
    .first()
    .waitFor()
  return page
}

const POLL = { timeout: 10_000 }
const panel = (page: Page) => page.locator('[role="tabpanel"]:visible')

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

/** What the "all" list holds in order: `deck` or the carousel's name. */
const order = (page: Page) =>
  panel(page)
    .locator('.timeline-list > li')
    .evaluateAll((items) =>
      items.map((item) =>
        item.classList.contains('timeline-carousel')
          ? (item.querySelector('.carousel-track')?.id ?? 'carousel')
          : 'deck',
      ),
    )

test('F44-AC1, F44-AC2, F44-AC3: Given the top page, When it opens, Then two tabs stand under the drop frame, "すべて" is chosen, and the arrow keys move between them without changing the URL', async () => {
  const page = await openTop()
  const tabs = page.getByRole('tab')
  expect(await tabs.allInnerTexts()).toEqual(['すべて', 'フォロー'])
  expect(await tabs.first().getAttribute('aria-selected')).toBe('true')
  await tabs.first().press('ArrowRight')
  expect(await tabs.nth(1).getAttribute('aria-selected')).toBe('true')
  expect(
    await tabs.nth(1).evaluate((tab) => document.activeElement === tab),
  ).toBe(true)
  await tabs.nth(1).press('Home')
  expect(await tabs.first().getAttribute('aria-selected')).toBe('true')
  expect(page.url()).toBe(`${TEST_ORIGIN}/`)
  expect((await tabs.first().boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.close()
})

test('F44-AC4, F44-AC10, F44-AC11: Given public slides, When the top opens at 1280px, Then they stand two across, newest first, each with a link to its viewer that has a name and no sentence', async () => {
  await seedDecks(3)
  await seedPublic(database, 'bobs', 900, 'Bob’s', BOB)
  const page = await openTop()
  const cards = panel(page).locator('.timeline-card')
  expect(await cards.count()).toBe(4)
  expect(await cards.first().locator('.timeline-card-title').innerText()).toBe(
    'Bob’s',
  )
  const first = (await cards.nth(0).boundingBox())!
  const second = (await cards.nth(1).boundingBox())!
  expect(second.y).toBe(first.y)
  expect(second.x).toBeGreaterThan(first.x)
  const open = cards.first().getByRole('link', { name: 'ビューアーで開く' })
  expect(await open.getAttribute('href')).toBe('/@bob/bobs')
  expect(await open.innerText()).toBe('')
  expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.close()
})

test('F44-AC10, F44-AC24: Given public slides, When the top opens at 375px, Then they stand one across and the page does not run sideways', async () => {
  await seedDecks(6)
  const page = await openTop({ width: 375 })
  const cards = panel(page).locator('.timeline-card')
  const first = (await cards.nth(0).boundingBox())!
  const second = (await cards.nth(1).boundingBox())!
  expect(second.x).toBe(first.x)
  expect(second.y).toBeGreaterThan(first.y)
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true)
  await page.close()
})

test('F44-AC15, F44-AC16: Given twelve slides, people and a community, When the top opens, Then people stand after the 4th slide and communities after the 10th, and "show more" adds slides without a carousel', async () => {
  await seedDecks(12)
  await seedCommunity(database, {
    id: 61,
    handle: 'kanagawapm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: BOB,
  })
  await seedDecks(3, BOB, 500)
  const page = await openTop()
  const placed = await order(page)
  expect(placed.slice(0, 5)).toEqual([
    'deck',
    'deck',
    'deck',
    'deck',
    'home-carousel-people',
  ])
  expect(placed.indexOf('home-carousel-communities')).toBe(11)
  expect(placed.filter((item) => item === 'deck')).toHaveLength(12)
  await panel(page).getByRole('button', { name: 'もっと見る' }).click()
  await expect
    .poll(() => order(page).then((items) => items.length), POLL)
    .toBe(17)
  expect(
    (await order(page)).filter((item) => item.startsWith('home-carousel')),
  ).toHaveLength(2)
  await panel(page).getByRole('tab').first().isVisible()
  await page.close()
})

test('F44-AC15: Given three slides, When the top opens, Then the carousels stand after the last slide, people first', async () => {
  await seedDecks(3)
  const page = await openTop()
  expect(await order(page)).toEqual([
    'deck',
    'deck',
    'deck',
    'home-carousel-people',
  ])
  await page.close()
})

test('F44-AC13, F44-AC25: Given 105 slides, When the top opens and "show more" is pressed, Then the next hundred come once, no slide twice, and scrolling adds nothing', async () => {
  await seedDecks(105)
  const page = await openTop()
  const cards = () => panel(page).locator('.timeline-card')
  expect(await cards().count()).toBe(12)
  await page.mouse.wheel(0, 100_000)
  await page.waitForTimeout(500)
  expect(await cards().count()).toBe(12)
  await panel(page).getByRole('button', { name: 'もっと見る' }).click()
  await expect.poll(() => cards().count(), POLL).toBe(105)
  const hrefs = await cards()
    .locator('.timeline-card-title')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
  expect(new Set(hrefs).size).toBe(105)
  expect(
    await panel(page).getByRole('button', { name: 'もっと見る' }).count(),
  ).toBe(0)
  await page.close()
}, 60_000)

test('F44-AC14: Given the next slides fail to load once, When "show more" is pressed, Then the slides stay, the failure is told, and asking again adds them', async () => {
  await seedDecks(14)
  const page = await openTop({ failMore: 1 })
  await panel(page).getByRole('button', { name: 'もっと見る' }).click()
  await panel(page).getByText('続きを読み込めませんでした。').waitFor(POLL)
  expect(await panel(page).locator('.timeline-card').count()).toBe(12)
  await panel(page).getByRole('button', { name: 'もう一度読み込む' }).click()
  await expect
    .poll(() => panel(page).locator('.timeline-card').count(), POLL)
    .toBe(14)
  await page.close()
})

test('F44-AC4, F44-AC17: Given Alice follows Carol, When she opens the top, Then the carousel offers Bob and not Carol or Alice', async () => {
  await seedPublic(database, 'bobs', 900, 'Bob’s', BOB)
  await seedPublic(database, 'mine', 800, 'Mine')
  await follow(database, { follower: OWNER_ID, followee: CAROL, now: 1 })
  const page = await openTop({ cookie: owner })
  expect(await panel(page).locator('.carousel-card').allInnerTexts()).toEqual([
    expect.stringContaining('@bob'),
  ])
  await page.close()
})

test('F44-AC19, F44-AC21: Given Alice with Bob in the people carousel, When she presses "フォロー", Then it becomes "フォロー中" in place, the follow is stored, and pressing again unfollows', async () => {
  await seedDecks(2)
  const page = await openTop({ cookie: owner })
  const card = panel(page).locator('.carousel-card', { hasText: '@bob' })
  expect(await card.innerText()).not.toMatch(/新しく|フォロワー|件/)
  const navigations: string[] = []
  page.on('framenavigated', (frame) => navigations.push(frame.url()))
  await card.getByRole('button', { name: '@bob をフォローする' }).click()
  await expect
    .poll(
      () =>
        card
          .getByRole('button', { name: '@bob のフォローを解除する' })
          .innerText(),
      POLL,
    )
    .toBe('フォロー中')
  expect(navigations).toEqual([])
  const stored = await database
    .prepare(
      'SELECT count(*) AS n FROM follows WHERE follower_user_id = ? AND followee_user_id = ?',
    )
    .bind(OWNER_ID, BOB)
    .first<{ n: number }>()
  expect(stored?.n).toBe(1)
  await card.getByRole('button', { name: '@bob のフォローを解除する' }).click()
  await card.getByRole('button', { name: '@bob をフォローする' }).waitFor(POLL)
  const gone = await database
    .prepare('SELECT count(*) AS n FROM follows WHERE follower_user_id = ?')
    .bind(OWNER_ID)
    .first<{ n: number }>()
  expect(gone?.n).toBe(0)
  await page.close()
})

test('F44-AC18, F44-AC20, F44-AC21: Given a community Alice does not follow, When she presses its "フォロー", Then the community follow is stored in place', async () => {
  await seedCommunity(database, {
    id: 61,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: BOB,
  })
  const page = await openTop({ cookie: owner })
  const card = panel(page).locator('.carousel-card', { hasText: 'Kanagawa.pm' })
  await card.getByRole('button', { name: 'Kanagawa.pm をフォローする' }).click()
  await card
    .getByRole('button', { name: 'Kanagawa.pm のフォローを解除する' })
    .waitFor(POLL)
  const stored = await database
    .prepare(
      'SELECT count(*) AS n FROM community_follows WHERE user_id = ? AND community_id = 61',
    )
    .bind(OWNER_ID)
    .first<{ n: number }>()
  expect(stored?.n).toBe(1)
  await page.close()
})

test('F44-AC22: Given a visitor who is not signed in, When they press a card’s "フォロー", Then the sign-in prompt opens and no follow is sent', async () => {
  await seedDecks(2)
  const page = await openTop()
  const posts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(request.url())
  })
  await panel(page).getByRole('link', { name: '@bob をフォローする' }).click()
  await page.getByRole('dialog').waitFor(POLL)
  expect(
    await page
      .getByRole('dialog')
      .getByRole('link', { name: 'ログインして続ける' })
      .getAttribute('href'),
  ).toBe('/login?to=top')
  expect(posts).toEqual([])
  await page.close()
})

test('F44-AC8: Given a visitor who is not signed in, When they choose "フォロー", Then no slide stands, the explanation and the way to sign in do, and "すべて" is one press away', async () => {
  await seedDecks(2)
  const page = await openTop()
  await page.getByRole('tab', { name: 'フォロー' }).click()
  const tab = panel(page)
  await tab
    .getByText('フォローした人やコミュニティの新しいスライドが、ここに並びます')
    .waitFor(POLL)
  expect(await tab.locator('.timeline-card').count()).toBe(0)
  expect(
    await tab
      .getByRole('link', { name: 'ログインしてフォローする' })
      .getAttribute('href'),
  ).toBe('/login?to=top')
  await tab.getByRole('button', { name: 'すべてを見る' }).click()
  expect(
    await page
      .getByRole('tab', { name: 'すべて' })
      .getAttribute('aria-selected'),
  ).toBe('true')
  await page.close()
})

test('F44-AC5, F44-AC7, F44-AC9: Given Alice follows Carol and a community, When she opens "フォロー", Then their slides stand as one list with their sources, and with nobody followed she is told so', async () => {
  const empty = await openTop({ cookie: owner })
  await empty.getByRole('tab', { name: 'フォロー' }).click()
  await panel(empty)
    .getByText('フォローしている人やコミュニティの新着は、まだありません。')
    .waitFor(POLL)
  await empty.close()

  await follow(database, { follower: OWNER_ID, followee: CAROL, now: 1 })
  await seedCommunity(database, {
    id: 61,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
  await unfollowCommunity(database, { userId: OWNER_ID, communityId: 61 })
  await followCommunity(database, { userId: OWNER_ID, communityId: 61, now: 1 })
  await seedPublic(database, 'carols', 300, 'Carol’s', CAROL)
  await seedPublic(database, 'bobs-talk', 200, 'Bob’s talk', BOB)
  await seedTalkLink(database, {
    deckId: 'bobs-talk',
    owner: BOB,
    url: 'https://kanagawapm.connpass.com/event/1/',
  })
  await drizzle(database)
    .insert(accounts)
    .values({ user_id: '4', handle: 'dave', created_at: 6 })
  await seedPublic(database, 'strangers', 900, 'Stranger’s', '4')
  const page = await openTop({ cookie: owner })
  await page.getByRole('tab', { name: 'フォロー' }).click()
  const cards = panel(page).locator('.timeline-card')
  await expect.poll(() => cards.count(), POLL).toBe(2)
  expect(await cards.locator('.timeline-card-title').allInnerTexts()).toEqual([
    'Carol’s',
    'Bob’s talk',
  ])
  expect(await cards.nth(0).locator('.source-label').innerText()).toBe(
    'フォロー中',
  )
  expect(await cards.nth(1).locator('.card-source').innerText()).toBe(
    'Kanagawa.pm',
  )
  expect(await panel(page).locator('.timeline-carousel').count()).toBe(0)
  await page.close()
})

/** Counts the requests for the "following" list a page sends. */
const countFollowingRequests = (page: Page) => {
  const seen: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/home/following-slides'))
      seen.push(request.url())
  })
  return seen
}

test('F44-AC26: Given Alice follows nobody, When she follows Bob in the carousel and then chooses "フォロー", Then Bob’s slide stands there, and unfollowing him takes it away again', async () => {
  await seedDecks(2)
  await seedPublic(database, 'bobs', 900, 'Bob’s', BOB)
  const page = await openTop({ cookie: owner })
  const requests = countFollowingRequests(page)
  const card = panel(page).locator('.carousel-card', { hasText: '@bob' })
  await card.getByRole('button', { name: '@bob をフォローする' }).click()
  await card
    .getByRole('button', { name: '@bob のフォローを解除する' })
    .waitFor(POLL)
  await page.getByRole('tab', { name: 'フォロー' }).click()
  await expect
    .poll(
      () =>
        panel(page)
          .locator('.timeline-card .timeline-card-title')
          .allInnerTexts(),
      POLL,
    )
    .toEqual(['Bob’s'])
  // One list asked for after the change, not one per press or per second.
  expect(requests).toHaveLength(1)

  await page.getByRole('tab', { name: 'すべて' }).click()
  await card.getByRole('button', { name: '@bob のフォローを解除する' }).click()
  await card.getByRole('button', { name: '@bob をフォローする' }).waitFor(POLL)
  await page.getByRole('tab', { name: 'フォロー' }).click()
  await panel(page)
    .getByText('フォローしている人やコミュニティの新着は、まだありません。')
    .waitFor(POLL)
  expect(await panel(page).locator('.timeline-card').count()).toBe(0)
  await page.close()
})

test('F44-AC26: Given Alice follows nobody, When she follows a community in the carousel and chooses "フォロー", Then the slides of its talks stand there', async () => {
  await seedCommunity(database, {
    id: 61,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: BOB,
  })
  await seedPublic(database, 'bobs-talk', 200, 'Bob’s talk', BOB)
  await seedTalkLink(database, {
    deckId: 'bobs-talk',
    owner: BOB,
    url: 'https://kanagawapm.connpass.com/event/1/',
  })
  const page = await openTop({ cookie: owner })
  const card = panel(page).locator('.carousel-card', { hasText: 'Kanagawa.pm' })
  await card.getByRole('button', { name: 'Kanagawa.pm をフォローする' }).click()
  await card
    .getByRole('button', { name: 'Kanagawa.pm のフォローを解除する' })
    .waitFor(POLL)
  await page.getByRole('tab', { name: 'フォロー' }).click()
  await expect
    .poll(
      () =>
        panel(page)
          .locator('.timeline-card .timeline-card-title')
          .allInnerTexts(),
      POLL,
    )
    .toEqual(['Bob’s talk'])
  await page.close()
})

test('F44-AC26: Given Alice already follows Carol, When she follows Bob twice over in a row (follow, unfollow, follow) and chooses "フォロー", Then Carol’s and Bob’s slides stand there from one request', async () => {
  await follow(database, { follower: OWNER_ID, followee: CAROL, now: 1 })
  await seedPublic(database, 'carols', 300, 'Carol’s', CAROL)
  await seedPublic(database, 'bobs', 900, 'Bob’s', BOB)
  const page = await openTop({ cookie: owner })
  const requests = countFollowingRequests(page)
  const card = panel(page).locator('.carousel-card', { hasText: '@bob' })
  await card.getByRole('button', { name: '@bob をフォローする' }).click()
  await card.getByRole('button', { name: '@bob のフォローを解除する' }).click()
  await card.getByRole('button', { name: '@bob をフォローする' }).click()
  await card
    .getByRole('button', { name: '@bob のフォローを解除する' })
    .waitFor(POLL)
  await page.getByRole('tab', { name: 'フォロー' }).click()
  await expect
    .poll(
      () =>
        panel(page)
          .locator('.timeline-card .timeline-card-title')
          .allInnerTexts(),
      POLL,
    )
    .toEqual(['Bob’s', 'Carol’s'])
  expect(requests).toHaveLength(1)
  await page.close()
})

test('F44-AC26: Given a visitor who is not signed in, When they press a card’s "フォロー" and then choose "フォロー", Then no list is asked for again', async () => {
  await seedDecks(2)
  const page = await openTop()
  const requests = countFollowingRequests(page)
  await panel(page).getByRole('link', { name: '@bob をフォローする' }).click()
  await page.getByRole('dialog').waitFor(POLL)
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'フォロー' }).click()
  await panel(page).locator('.home-prompt').waitFor(POLL)
  expect(requests).toEqual([])
  await page.close()
})

test('F44-AC16: Given "show more" was pressed in "すべて", When the visitor goes to "フォロー" and back, Then "すべて" starts again from its first slides', async () => {
  await seedDecks(14)
  const page = await openTop()
  await panel(page).getByRole('button', { name: 'もっと見る' }).click()
  await expect
    .poll(() => panel(page).locator('.timeline-card').count(), POLL)
    .toBe(14)
  await page.getByRole('tab', { name: 'フォロー' }).click()
  await page.getByRole('tab', { name: 'すべて' }).click()
  await expect
    .poll(() => panel(page).locator('.timeline-card').count(), POLL)
    .toBe(12)
  await page.close()
})

test('F44-AC23: Given a carousel with many people, When it is wider than its place, Then the track slides and the page does not, and the arrows slide it', async () => {
  const orm = drizzle(database)
  await orm.insert(accounts).values(
    Array.from({ length: 10 }, (_, i) => ({
      user_id: `9${i}`,
      handle: `p${i}`,
      created_at: 100 + i,
    })),
  )
  await seedDecks(5)
  const page = await openTop()
  const track = panel(page).locator('#home-carousel-people')
  const scrollable = await track.evaluate(
    (el) => el.scrollWidth > el.clientWidth,
  )
  expect(scrollable).toBe(true)
  await panel(page).getByRole('button', { name: '次へ' }).first().click()
  await expect
    .poll(() => track.evaluate((el) => el.scrollLeft), POLL)
    .toBeGreaterThan(0)
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true)
  await page.close()
})
