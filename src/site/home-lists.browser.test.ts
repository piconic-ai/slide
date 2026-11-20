import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { accounts, follows } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedDeck,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

// The page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = testEnv(platform.env)

let browser: Browser
let owner = ''
beforeAll(async () => {
  await applyMigrations(database)
  browser = await chromium.launch()
}, 60_000)
// Signing in runs the whole callback; a busy machine needs more than 10s.
beforeEach(async () => {
  await resetTables(database)
  // Signing in records the handle "owner" from the stubbed GitHub login.
  owner = await signIn(env)
  await db
    .insert(accounts)
    .values({ user_id: INVITED_ID, handle: 'bob', created_at: 1 })
}, 60_000)
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
}, 60_000)

type Options = {
  /** The session cookie the page's requests carry; none for a visitor. */
  cookie?: string
  /** What this browser kept from an earlier visit. */
  kept?: Record<string, string>
  /** Holds the lists' answer until it is called. */
  hold?: boolean
  viewport?: { width: number; height: number }
}

/** Opens the top page, answering its requests with the Worker. */
async function openTop(options: Options = {}) {
  const page = await browser.newPage({
    viewport: options.viewport ?? { width: 1280, height: 900 },
  })
  const errors: string[] = []
  const asked: string[] = []
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  if (options.kept)
    await page.addInitScript((kept) => {
      for (const [key, value] of Object.entries(kept))
        localStorage.setItem(key, value)
    }, options.kept)
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    asked.push(url.pathname)
    if (options.hold && url.pathname === '/api/home') await held
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
  return { page, errors, asked, release }
}

const settled = (page: Page) =>
  page.locator('.recent-list:not(.recent-loading)').waitFor()

const headings = (page: Page) => page.locator('main h2').allTextContents()

async function seedLists(title = 'My <b>public</b> talk') {
  await seedPublic(database, 'mine', 300, title)
  await seedDeck(database, 'draft')
  await db.insert(follows).values({
    follower_user_id: OWNER_ID,
    followee_user_id: INVITED_ID,
    created_at: 1,
  })
  await seedPublic(database, 'bobs', 200, 'Bob’s talk', INVITED_ID)
}

test('F21-AC15 / F21-AC16: Given a signed-in visitor with slides who follows an author with a public slide, When the top page opens, Then their own slides and the new ones show above the recent slides', async () => {
  await seedLists()
  const { page, errors, asked } = await openTop({ cookie: owner })
  await page.locator('.home-own .deck-card a').first().waitFor()
  await settled(page)
  expect(await headings(page)).toEqual([
    '自分のスライド',
    'フォロー中の人の新着',
    '最近のスライド',
  ])
  const own = page.locator('.home-own .deck-card')
  expect(await own.locator('.deck-name').allTextContents()).toEqual([
    'My <b>public</b> talk',
    'draft',
  ])
  expect(await own.locator('.status-chip').allTextContents()).toEqual([
    '公開中',
    '作者のみ',
  ])
  expect(
    await own
      .locator('a.card-title')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  ).toEqual(['/slides/mine', '/slides/draft'])
  const seeAll = page.getByRole('link', { name: 'すべて見る' })
  expect(await seeAll.getAttribute('href')).toBe('/slides')
  expect((await seeAll.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  const following = page.locator('.home-following .deck-card')
  expect(await following.locator('.deck-name').allTextContents()).toEqual([
    'Bob’s talk',
  ])
  expect(await following.locator('a.card-title').getAttribute('href')).toBe(
    '/@bob/bobs',
  )
  expect(await following.locator('.card-meta a').textContent()).toBe('@bob')
  // Both lists come from one request.
  expect(asked.filter((path) => path === '/api/home')).toHaveLength(1)
  expect(errors).toEqual([])
  await page.close()
})

test('F21-AC17: Given a signed-in visitor without slides who follows nobody, When the top page opens, Then neither section shows, heading and all', async () => {
  await seedPublic(database, 'bobs', 200, 'Bob’s talk', INVITED_ID)
  const { page, errors, asked } = await openTop({ cookie: owner })
  await settled(page)
  await expect.poll(() => asked.includes('/api/home')).toBe(true)
  expect(await headings(page)).toEqual(['最近のスライド'])
  expect(await page.locator('.home-list section').count()).toBe(0)
  expect(errors).toEqual([])
  await page.close()
})

test('F21-AC18: Given a visitor who is not signed in, though this browser kept a signed-in session and a shape, When the top page opens, Then neither section stays', async () => {
  await seedLists()
  const { page, errors } = await openTop({
    kept: {
      'slide:session': JSON.stringify({ signedIn: true, login: 'owner' }),
      'slide:home': JSON.stringify({ own: 2, following: 1 }),
    },
  })
  await settled(page)
  await expect.poll(() => page.locator('.home-list section').count()).toBe(0)
  expect(await headings(page)).toEqual(['最近のスライド'])
  expect(await page.locator('.home-list').allTextContents()).toEqual(['', ''])
  expect(errors).toEqual([])
  await page.close()
})

test.each([
  { width: 1280, height: 900 },
  { width: 375, height: 800 },
])(
  'F21-AC15: Given a returning signed-in visitor at $width px, When the lists are still on their way, Then placeholders of the same size hold their place and nothing moves when they come',
  async (viewport) => {
    // A name that fits one line: a longer one wraps, and a card grows by it.
    await seedLists('Mine')
    const { page, release } = await openTop({
      cookie: owner,
      hold: true,
      viewport,
      kept: {
        'slide:session': JSON.stringify({ signedIn: true, login: 'owner' }),
        'slide:home': JSON.stringify({ own: 2, following: 1 }),
      },
    })
    await settled(page)
    const recentTop = () =>
      page
        .locator('#recent')
        .evaluate((heading) =>
          Math.round(heading.getBoundingClientRect().top + window.scrollY),
        )
    await page.locator('.home-own .home-loading').waitFor()
    expect(await page.locator('.home-own .home-loading li').count()).toBe(2)
    expect(await page.locator('.home-following .home-loading li').count()).toBe(
      1,
    )
    // Placeholders are not read out and lead nowhere.
    expect(await page.locator('.home-list section a').count()).toBe(0)
    const before = await recentTop()
    release()
    await page.locator('.home-own .deck-card a').first().waitFor()
    await page.locator('.home-following .deck-card a').first().waitFor()
    expect(await recentTop()).toBe(before)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    // The next visit holds the shape that came.
    expect(await page.evaluate(() => localStorage.getItem('slide:home'))).toBe(
      '{"own":2,"following":1}',
    )
    await page.close()
  },
)
