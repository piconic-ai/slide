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
  /** Holds the lists' answer until it is called. */
  hold?: boolean
  /** Holds the answer about who is signed in until it is called. */
  holdSession?: boolean
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
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    asked.push(url.pathname)
    if (options.hold && url.pathname === '/api/home') await held
    if (options.holdSession && url.pathname === '/api/session') await held
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

async function seedFollowing() {
  await seedPublic(database, 'mine', 300, 'Mine')
  await seedDeck(database, 'draft')
  await db.insert(follows).values({
    follower_user_id: OWNER_ID,
    followee_user_id: INVITED_ID,
    created_at: 1,
  })
  await seedPublic(database, 'bobs', 200, 'Bob’s talk', INVITED_ID)
}

const recentTop = (page: Page) =>
  page
    .locator('#recent')
    .evaluate((heading) =>
      Math.round(heading.getBoundingClientRect().top + window.scrollY),
    )

test('F21-AC16, F21-AC42: Given a signed-in visitor with slides who follows an author with a public slide, When the top page opens, Then the new slides show above the recent slides and no list of their own slides shows', async () => {
  await seedFollowing()
  const { page, errors, asked } = await openTop({ cookie: owner })
  await page.locator('.home-following .deck-card a').first().waitFor()
  await settled(page)
  expect(await headings(page)).toEqual([
    'フォロー中の人の新着',
    '最近のスライド',
  ])
  expect(await page.locator('main').textContent()).not.toContain(
    '自分のスライド',
  )
  expect(await page.locator('.home-own').count()).toBe(0)
  const following = page.locator('.home-following .deck-card:not(.home-spare)')
  expect(await following.locator('.deck-name').allTextContents()).toEqual([
    'Bob’s talk',
  ])
  expect(await following.locator('a.card-title').getAttribute('href')).toBe(
    '/@bob/bobs',
  )
  expect(await following.locator('.card-meta a').textContent()).toBe('@bob')
  expect(asked.filter((path) => path === '/api/home')).toHaveLength(1)
  expect(errors).toEqual([])
  await page.close()
})

test.each([
  { width: 1280, height: 900 },
  { width: 375, height: 800 },
])(
  'F21-AC43: Given a signed-in visitor at $width px, When the list is on its way, comes with one slide, or comes with none, Then the recent slides stay where they were and spares or a message stand in the room',
  async (viewport) => {
    await seedPublic(database, 'bobs', 200, 'Bob’s talk', INVITED_ID)
    const held = await openTop({ cookie: owner, hold: true, viewport })
    await settled(held.page)
    await held.page.locator('.home-following .home-loading').waitFor()
    expect(
      await held.page.locator('.home-following .home-loading li').count(),
    ).toBe(4)
    // Placeholders are not read out and lead nowhere.
    expect(await held.page.locator('.home-following a').count()).toBe(0)
    const before = await recentTop(held.page)
    held.release()
    await held.page
      .locator('.home-following-empty')
      .waitFor({ state: 'visible' })
    expect(await held.page.locator('.home-following-empty').textContent()).toBe(
      'フォローしている人の新着は、まだありません。',
    )
    expect(await recentTop(held.page)).toBe(before)
    await held.page.close()
    // One slide came: three spares keep the room.
    await db.insert(follows).values({
      follower_user_id: OWNER_ID,
      followee_user_id: INVITED_ID,
      created_at: 1,
    })
    const one = await openTop({ cookie: owner, viewport })
    await one.page.locator('.home-following .deck-card a').first().waitFor()
    await settled(one.page)
    expect(await one.page.locator('.home-following .home-spare').count()).toBe(
      3,
    )
    expect(await one.page.locator('.home-following-empty').count()).toBe(0)
    expect(await recentTop(one.page)).toBe(before)
    expect(
      await one.page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await one.page.close()
  },
)

test('F21-AC44, F03-AC81: Given a visitor who is not signed in, When the top page opens and the answer for the new slides comes after it, Then no heading, placeholder or room is held for them, and the recent slides do not move', async () => {
  await seedFollowing()
  const { page, errors, release } = await openTop({ hold: true })
  await settled(page)
  const before = await recentTop(page)
  expect(await page.locator('[data-home-frame="following"]').isVisible()).toBe(
    false,
  )
  expect(await page.locator('.home').getAttribute('data-member')).toBe('no')
  release()
  await expect
    .poll(() => page.locator('.home-following').count(), { timeout: 3000 })
    .toBe(0)
  expect(await recentTop(page)).toBe(before)
  expect(errors).toEqual([])
  await page.close()
})

test('F21-AC44: Given a visitor who is not signed in, When the lists have come, Then neither the heading nor any card of the new slides is in the page', async () => {
  await seedFollowing()
  const { page, errors } = await openTop()
  await settled(page)
  await expect.poll(() => page.locator('.home-list section').count()).toBe(0)
  expect(await headings(page)).toEqual(['最近のスライド'])
  expect(await page.locator('.home-list').allTextContents()).toEqual([''])
  expect(errors).toEqual([])
  await page.close()
})

test.each([
  { width: 1280, height: 900 },
  { width: 375, height: 800 },
])(
  'F03-AC80: Given a signed-in visitor at $width px, When the answer about who is signed in is still on its way, Then the place to drop slides is already the small one, and does not change when the answer comes',
  async (viewport) => {
    const { page, release } = await openTop({
      cookie: owner,
      holdSession: true,
      viewport,
    })
    const zone = page.locator('[data-drop-zone="new"]')
    await zone.waitFor()
    expect(
      await zone.evaluate((el) => el.classList.contains('drop-zone-large')),
    ).toBe(true)
    const height = () =>
      zone.evaluate((el) => el.getBoundingClientRect().height)
    const before = await height()
    release()
    await expect
      .poll(() =>
        zone.evaluate((el) => el.classList.contains('drop-zone-large')),
      )
      .toBe(false)
    expect(await height()).toBe(before)
    await page.close()
  },
)
