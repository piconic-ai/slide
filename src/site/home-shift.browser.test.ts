import { openTestBrowser } from '../test-open-browser'
import { writeFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Browser, Page } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { accounts, follows } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { followCommunity } from '../communities/follow-store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from '../communities/test-communities'
import {
  INVITED_ID,
  OWNER_ID,
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
beforeEach(async () => {
  await resetCommunities(database)
  owner = await signIn(env)
  await db
    .insert(accounts)
    .values({ user_id: INVITED_ID, handle: 'bob', created_at: 1 })
}, 60_000)
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
}, 60_000)

type Shifted = Window & { __shift?: number }

type Options = {
  /** The session cookie the page's requests carry; none for a visitor. */
  cookie?: string
  /** What this browser kept from an earlier visit. */
  kept?: Record<string, string>
  viewport?: { width: number; height: number }
  /** Slows the answers of the lists, as a real network does. */
  delay?: number
  /** Answers the new slides with a server error. */
  failHome?: boolean
}

/** Opens the top page and returns how far it moved until everything came. */
async function shiftOfTop(options: Options = {}): Promise<number> {
  const page: Page = await browser.newPage({
    viewport: options.viewport ?? { width: 1280, height: 900 },
  })
  await page.addInitScript(() => {
    const w = window as Shifted
    w.__shift = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number
        hadRecentInput: boolean
      }[])
        if (!entry.hadRecentInput) w.__shift = (w.__shift ?? 0) + entry.value
    }).observe({ type: 'layout-shift', buffered: true })
  })
  if (options.kept)
    await page.addInitScript((kept) => {
      for (const [key, value] of Object.entries(kept))
        localStorage.setItem(key, value)
    }, options.kept)
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    if (options.delay && url.pathname.startsWith('/api/'))
      await new Promise((resolve) => setTimeout(resolve, options.delay))
    if (options.failHome && url.pathname === '/api/home')
      return route.fulfill({ status: 500, body: '{}' })
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
  // The recent list settles into cards, or into its note alone when none
  // is public (F03-AC176).
  await page
    .locator('.recent-list:not(.recent-loading), .recent-body .home-room-empty')
    .first()
    .waitFor()
  await new Promise((resolve) => setTimeout(resolve, 800))
  const moved = await page.evaluate(() => (window as Shifted).__shift ?? 0)
  await page.close()
  return moved
}

async function follow(count: number) {
  // A public slide of their own keeps the recent slides from being empty.
  await seedPublic(database, 'mine', 100, 'Mine')
  await db.insert(follows).values({
    follower_user_id: OWNER_ID,
    followee_user_id: INVITED_ID,
    created_at: 1,
  })
  for (let index = 0; index < count; index++)
    await seedPublic(
      database,
      `bobs-${index}`,
      200 + index,
      `A long name of a talk that wraps onto a second line ${index}`,
      INVITED_ID,
    )
}

/** The visitor follows a community that got `count` public slides of Bob's. */
async function followCommunityWith(count: number) {
  await seedCommunity(database, {
    id: 61,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
  })
  await followCommunity(database, { userId: OWNER_ID, communityId: 61, now: 1 })
  for (let index = 0; index < count; index++) {
    await seedPublic(
      database,
      `talk-${index}`,
      300 + index,
      `A long name of a talk at a community that wraps ${index}`,
      INVITED_ID,
    )
    await seedTalkLink(database, {
      deckId: `talk-${index}`,
      owner: INVITED_ID,
      url: `https://kanagawapm.connpass.com/event/${300 + index}/`,
    })
  }
}

const viewports = [
  { width: 1280, height: 900 },
  { width: 375, height: 800 },
]

/** The values measured are kept for the pull request when asked for. */
const measured: Record<string, number> = {}
afterAll(() => {
  if (process.env.SHIFT_OUT)
    writeFileSync(process.env.SHIFT_OUT, JSON.stringify(measured, null, 1))
})

describe.each(viewports)('at $width px', (viewport) => {
  test.each([4, 1, 0])(
    'F03-AC178: Given a signed-in author on a browser that kept nothing, with %i new slides of people they follow, When the top page opens on recent slides and the lists come behind their tabs, Then the page moves no more than 0.1',
    async (count) => {
      await follow(count)
      const moved = await shiftOfTop({ cookie: owner, viewport, delay: 150 })
      measured[`${viewport.width} signed-in, first device, ${count} new`] =
        moved
      expect(moved).toBeLessThanOrEqual(0.1)
    },
    60_000,
  )

  test.each([8, 1, 0])(
    'F03-AC178: Given a signed-in visitor who follows a community with %i new slides, When the top page opens on recent slides and the lists come behind their tabs, Then the page moves no more than 0.1',
    async (count) => {
      await follow(4)
      await followCommunityWith(count)
      const moved = await shiftOfTop({ cookie: owner, viewport, delay: 150 })
      measured[`${viewport.width} follows a community, ${count} new`] = moved
      expect(moved).toBeLessThanOrEqual(0.1)
    },
    60_000,
  )

  test('F03-AC178: Given a signed-in visitor who follows a community, When they open its tab and its new slides come late, Then the tabs above stay where they stood and so does the footer', async () => {
    await follow(4)
    await followCommunityWith(3)
    const page = await browser.newPage({ viewport })
    const list = Promise.withResolvers<void>()
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== TEST_ORIGIN) return route.abort()
      if (url.pathname === '/api/home/communities') await list.promise
      const { origin: _origin, ...headers } = await route.request().allHeaders()
      headers.cookie = owner
      const response = await server.fetch(new Request(url, { headers }), env)
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      })
    })
    const topOf = (selector: string) =>
      page
        .locator(selector)
        .evaluate((node) =>
          Math.round(node.getBoundingClientRect().top + window.scrollY),
        )
    await page.goto(`${TEST_ORIGIN}/`)
    await page.locator('.recent-list:not(.recent-loading)').waitFor()
    const tabsBefore = await topOf('[role="tablist"]')
    await page
      .getByRole('tab', { name: 'フォローコミュニティ', exact: true })
      .click()
    await page.locator('.home-communities .home-loading').waitFor()
    expect(await topOf('[role="tablist"]')).toBe(tabsBefore)
    const before = await topOf('.site-footer')
    list.resolve()
    await page
      .locator('.home-communities .deck-card:not(.home-spare) .card-title')
      .first()
      .waitFor()
    expect(await topOf('.site-footer')).toBe(before)
    expect(await topOf('[role="tablist"]')).toBe(tabsBefore)
    await page.close()
  }, 60_000)

  test('F03-AC178: Given the following list cannot be loaded, When the top page opens on recent slides, Then the failure behind its tab moves the page no more than 0.1', async () => {
    await follow(4)
    const moved = await shiftOfTop({
      cookie: owner,
      viewport,
      delay: 150,
      failHome: true,
    })
    measured[`${viewport.width} signed-in, new slides failed`] = moved
    expect(moved).toBeLessThanOrEqual(0.1)
  }, 60_000)

  test('F03-AC176: Given no slide is public, When the top page opens and the recent list leaves its room for the note alone, Then how far the page moved is measured, for a visitor signed in or not', async () => {
    for (const cookie of [owner, undefined]) {
      const moved = await shiftOfTop({ cookie, viewport, delay: 150 })
      measured[
        `${viewport.width} no public slide, ${cookie ? 'signed in' : 'signed out'}`
      ] = moved
      // F03-AC176 lets the room go, which moves the page once; recorded,
      // not held to the limit of F03-AC178.
      expect(moved).toBeLessThan(1)
    }
  }, 60_000)

  test('Given a cookie that no longer holds a session, When the top page opens, Then it is put back as for a visitor, and how far it moved once is measured', async () => {
    await follow(4)
    measured[`${viewport.width} stale cookie`] = await shiftOfTop({
      cookie: '__Host-slide_owner=stale',
      viewport,
      delay: 150,
    })
  }, 60_000)

  test('F03-AC81: Given a visitor who is not signed in, When the top page opens, Then the page moves no more than 0.1, though the browser kept a signed-in session', async () => {
    await follow(4)
    const kept = {
      'slide:session': JSON.stringify({ signedIn: true, login: 'owner' }),
    }
    const fresh = await shiftOfTop({ viewport, delay: 150 })
    const stale = await shiftOfTop({ viewport, delay: 150, kept })
    measured[`${viewport.width} signed-out`] = fresh
    measured[`${viewport.width} signed-out, stale memory`] = stale
    expect(fresh).toBeLessThanOrEqual(0.1)
    expect(stale).toBeLessThanOrEqual(0.1)
  }, 60_000)

  test.each(['two', 'none', 'failed'] as const)(
    'F03-AC178, F03-AC176: Given %s new communities, When a visitor not signed in opens their tab and they come late, Then the footer stays where the placeholders put it, but for none, where only the note stays',
    async (kind) => {
      if (kind === 'two')
        for (const [id, handle] of [
          [71, 'kanagawapm'],
          [72, 'hono'],
        ] as const)
          await seedCommunity(database, {
            id,
            handle,
            name: `A long name of a community that wraps ${handle}`,
            links: [`https://${handle}.connpass.com/`],
          })
      const page = await browser.newPage({ viewport })
      const list = Promise.withResolvers<void>()
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== TEST_ORIGIN) return route.abort()
        if (url.pathname === '/api/public/communities') {
          await list.promise
          if (kind === 'failed')
            return route.fulfill({ status: 500, body: '{}' })
        }
        const { origin: _origin, ...headers } = await route
          .request()
          .allHeaders()
        const response = await server.fetch(new Request(url, { headers }), env)
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        })
      })
      const footerTop = () =>
        page
          .locator('.site-footer')
          .evaluate((footer) =>
            Math.round(footer.getBoundingClientRect().top + window.scrollY),
          )
      await page.goto(`${TEST_ORIGIN}/`)
      await page
        .getByRole('tab', { name: '最近のコミュニティ', exact: true })
        .click()
      await page.locator('.home-new-communities .home-loading').waitFor()
      const before = await footerTop()
      list.resolve()
      if (kind === 'none') {
        // F03-AC176: nothing to show, so the room goes and the note stays.
        await page.locator('.home-new-communities .home-room-empty').waitFor()
        expect(
          await page.locator('.home-new-communities .community-card').count(),
        ).toBe(0)
        expect(await footerTop()).toBeLessThan(before)
        await page.close()
        return
      }
      // Attached: with only spares, hidden on a narrow screen, it has no box.
      await page
        .locator('.home-new-communities ul:not(.home-loading)')
        .waitFor({ state: 'attached' })
      if (kind !== 'two')
        await page.locator('.home-new-communities .home-room-note').waitFor()
      // F03-AC179: on a narrow screen the room of the missing cards goes.
      if (viewport.width < 600) expect(await footerTop()).toBeLessThan(before)
      else expect(await footerTop()).toBe(before)
      if (kind === 'failed')
        await expect(
          page.locator('.home-new-communities .home-room-note button').count(),
        ).resolves.toBe(1)
      await page.close()
    },
    60_000,
  )

  test('F03-AC83: Given three recent slides with long names, When the top page opens and they come, Then the footer stays where the placeholders put it', async () => {
    for (let index = 0; index < 3; index++)
      await seedPublic(
        database,
        `recent-${index}`,
        100 + index,
        `A long name of a talk that wraps onto a second line ${index}`,
      )
    const page = await browser.newPage({ viewport })
    const list = Promise.withResolvers<void>()
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== TEST_ORIGIN) return route.abort()
      if (url.pathname === '/api/public/slides') await list.promise
      const { origin: _origin, ...headers } = await route.request().allHeaders()
      const response = await server.fetch(new Request(url, { headers }), env)
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      })
    })
    const footerTop = () =>
      page
        .locator('.site-footer')
        .evaluate((footer) =>
          Math.round(footer.getBoundingClientRect().top + window.scrollY),
        )
    await page.goto(`${TEST_ORIGIN}/`)
    await page.locator('.recent-loading').waitFor()
    const before = await footerTop()
    list.resolve()
    await page.locator('.recent-list:not(.recent-loading)').waitFor()
    // F03-AC179: on a narrow screen the room of the missing cards goes.
    if (viewport.width < 600) expect(await footerTop()).toBeLessThan(before)
    else expect(await footerTop()).toBe(before)
    await page.close()
  }, 60_000)
})
