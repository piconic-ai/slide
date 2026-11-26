import { openTestBrowser } from '../test-open-browser'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import type { Browser, Page } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
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
  browser = await openTestBrowser()
}, 60_000)
// Signing in runs the whole callback; a busy machine needs more than 10s.
beforeEach(async () => {
  await resetTables(database)
  // Signing in records the handle "owner".
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

/** Where the footer stands on the page: it must not move (F03-AC170). */
const footerTop = (page: Page) =>
  page
    .locator('.site-footer')
    .evaluate((footer) =>
      Math.round(footer.getBoundingClientRect().top + window.scrollY),
    )

const chooseTab = (page: Page, name: string) =>
  page.getByRole('tab', { name, exact: true }).click()

async function seedMembersSlides() {
  await seedPublic(database, 'mine', 300, 'Mine')
  await seedDeck(database, 'draft')
  await seedPublic(database, 'bobs', 200, 'Bob’s talk', INVITED_ID)
}

function followBob() {
  return db.insert(follows).values({
    follower_user_id: OWNER_ID,
    followee_user_id: INVITED_ID,
    created_at: 1,
  })
}

test.each([
  { width: 1280, height: 900 },
  { width: 375, height: 800 },
])(
  'F03-AC170, F21-AC67: Given a signed-in visitor at $width px, When they open the following tab while its list is on its way, Then eight placeholders hold its room, the note for no slide comes over it, and with a followed author his slide comes with seven spares, the footer staying put',
  async (viewport) => {
    await seedMembersSlides()
    const held = await openTop({ cookie: owner, hold: true, viewport })
    await settled(held.page)
    await chooseTab(held.page, 'フォロー')
    await held.page.locator('.home-following ul[aria-busy="true"]').waitFor()
    expect(
      await held.page.locator('.home-following .home-loading li').count(),
    ).toBe(8)
    expect(
      await held.page
        .locator('.home-following [role="status"]')
        .first()
        .textContent(),
    ).toBe('読み込み中')
    const before = await footerTop(held.page)
    held.release()
    const note = held.page.locator('.home-following .home-room-note')
    await note.waitFor({ state: 'visible' })
    expect(await note.locator('p').textContent()).toBe(
      'フォローしている人の新着は、まだありません。',
    )
    expect(
      await held.page.locator('.home-following [aria-busy="true"]').count(),
    ).toBe(0)
    expect(await footerTop(held.page)).toBe(before)
    // F03-AC169: the note leads to recent slides.
    await note.getByRole('button', { name: '最近のスライドを見る' }).click()
    expect(
      await held.page
        .getByRole('tab', { name: '最近のスライド', selected: true })
        .count(),
    ).toBe(1)
    await held.page.close()

    await followBob()
    const one = await openTop({ cookie: owner, viewport })
    await settled(one.page)
    await chooseTab(one.page, 'フォロー')
    await one.page.locator('.home-following .deck-card a').first().waitFor()
    expect(await one.page.locator('main').textContent()).not.toContain(
      '自分のスライド',
    )
    const card = one.page.locator('.home-following .deck-card:not(.home-spare)')
    expect(await card.locator('.deck-name').allTextContents()).toEqual([
      'Bob’s talk',
    ])
    expect(await card.locator('a.card-title').getAttribute('href')).toBe(
      '/@bob/bobs',
    )
    expect(
      await card.getByRole('link', { name: '@bob' }).getAttribute('href'),
    ).toBe('/@bob')
    expect(one.asked.filter((path) => path === '/api/home')).toHaveLength(1)
    expect(one.errors).toEqual([])
    expect(await one.page.locator('.home-following .home-spare').count()).toBe(
      7,
    )
    expect(
      await one.page.locator('.home-following .home-room-note').count(),
    ).toBe(0)
    expect(await footerTop(one.page)).toBe(before)
    expect(
      await one.page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await one.page.close()
  },
  60_000,
)

test('F03-AC167, F03-AC168: Given a visitor who is not signed in, When they open the following tabs, Then no slide shows there but what following does, a way to sign in that returns to the top page, and a way to the recent lists', async () => {
  await seedMembersSlides()
  await followBob()
  const { page, errors } = await openTop()
  await settled(page)
  expect(await page.locator('.home').getAttribute('data-member')).toBe('no')

  await chooseTab(page, 'フォロー')
  const people = page.locator('.home-following .home-prompt')
  await people.waitFor({ state: 'visible' })
  expect(await people.locator('.home-prompt-title').textContent()).toBe(
    'フォローした人の新しいスライドが、ここに並びます',
  )
  expect(await page.locator('.home-following .deck-card a').count()).toBe(0)
  expect(
    await people
      .getByRole('link', { name: 'ログインしてフォローする' })
      .getAttribute('href'),
  ).toBe('/login?to=top')
  await people.getByRole('button', { name: '最近のスライドを見る' }).click()
  expect(
    await page
      .getByRole('tab', { name: '最近のスライド', selected: true })
      .count(),
  ).toBe(1)

  await chooseTab(page, 'フォローコミュニティ')
  const communities = page.locator('.home-communities .home-prompt')
  await communities.waitFor({ state: 'visible' })
  expect(await communities.locator('.home-prompt-title').textContent()).toBe(
    'フォローしたコミュニティの新しい発表が、ここに並びます',
  )
  await communities
    .getByRole('button', { name: '最近のコミュニティを見る' })
    .click()
  expect(
    await page
      .getByRole('tab', { name: '最近のコミュニティ', selected: true })
      .count(),
  ).toBe(1)
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/')
  expect(errors).toEqual([])
  await page.close()
}, 60_000)

test.each([
  { width: 1280, height: 900 },
  { width: 375, height: 800 },
])(
  'Given a signed-in visitor at $width px, When the answer about who is signed in is still on its way, Then the place to drop slides is already the small one, and does not change when the answer comes',
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

test('F03-AC170: Given a signed-in visitor whose following list failed to load, When they retry with the keyboard, Then the list loads on the second request', async () => {
  let tries = 0
  const page = await browser.newPage()
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    if (url.pathname === '/api/home' && ++tries === 1)
      return route.fulfill({ status: 500, body: '{}' })
    const { origin: _origin, ...headers } = await route.request().allHeaders()
    headers.cookie = owner
    const response = await server.fetch(new Request(url, { headers }), env)
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}/`)
  await chooseTab(page, 'フォロー')
  const note = page.locator('.home-following .home-room-note[role="status"]')
  await note.waitFor()
  expect(await note.locator('p').textContent()).toBe(
    '新着を読み込めませんでした。',
  )
  const retry = note.getByRole('button', { name: 'もう一度読み込む' })
  expect((await retry.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await retry.focus()
  await page.keyboard.press('Enter')
  await expect
    .poll(() => page.locator('.home-following .home-room-note p').textContent())
    .toBe('フォローしている人の新着は、まだありません。')
  expect(
    await note.getByRole('button', { name: 'もう一度読み込む' }).count(),
  ).toBe(0)
  expect(tries).toBe(2)
  await page.close()
})

test('F03-AC167, F03-AC170: Given a stale session and no public slides, When the top page opens, Then the recent list announces it is empty, and the following tab offers to sign in', async () => {
  const { page } = await openTop({ cookie: '__Host-slide_owner=stale' })
  await expect
    .poll(() => page.locator('.home').getAttribute('data-member'))
    .toBe('no')
  await settled(page)
  expect(await page.locator('.recent-body .home-room-note').textContent()).toBe(
    '公開されたスライドは、まだありません。',
  )
  expect(await page.locator('.recent-list .home-spare').count()).toBe(8)
  await chooseTab(page, 'フォロー')
  await page
    .locator('.home-following .home-prompt')
    .waitFor({ state: 'visible' })
  await page.close()
})
