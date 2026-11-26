import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { events } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { eventRefOf } from './event-url'
import { addLink } from '../links/store'
import {
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

// Words with no place to break, as titles sometimes are.
const LONG =
  'Supercalifragilisticexpialidocious_and_a_very_long_unbroken_event_name_x'
const URLS = [
  'https://kanagawapm.connpass.com/event/410635/',
  'https://luma.com/a-very-long-luma-event-name-without-any-break-at-all-0123456789',
  'https://peatix.com/event/1234567890/view/with/a/long/path/that/does/not/break',
] as const

let browser: Browser
let cookie = ''
let eventId = 0
beforeAll(async () => {
  await applyMigrations(db)
  cookie = await signIn(env)
  for (let index = 0; index < 4; index++)
    await seedPublic(db, `talk-${index}`, 100 + index, `${LONG} ${index}`)
  for (const [index, url] of URLS.entries())
    await addLink(db, {
      deckId: 'talk-0',
      ownerUserId: OWNER_ID,
      link: {
        kind: 'event',
        url,
        title: index === 0 ? LONG : null,
        event: eventRefOf(url)!,
      },
      now: 1,
    })
  for (let index = 1; index < 4; index++)
    await addLink(db, {
      deckId: `talk-${index}`,
      ownerUserId: OWNER_ID,
      link: {
        kind: 'event',
        url: URLS[0],
        title: null,
        event: eventRefOf(URLS[0])!,
      },
      now: 1,
    })
  eventId = (await drizzle(db)
    .select()
    .from(events)
    .where(eq(events.key, 'https://connpass.com/event/410635'))
    .get())!.id
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

async function open(path: string, width: number, signedIn: boolean) {
  const page = await browser.newPage({
    viewport: { width, height: 800 },
    locale: 'ja-JP',
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    const { origin: _origin, ...headers } = await route.request().allHeaders()
    if (signedIn) headers.cookie = cookie
    const response = await server.fetch(new Request(url, { headers }), env)
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}${path}`)
  await page.waitForLoadState('networkidle')
  return page
}

const overflow = (): number =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth

test.each([
  ['the event page', (): string => `/events/${eventId}`, false],
  ['the related links of one slide', (): string => '/my/slides/talk-0', true],
] as const)(
  'F29-AC25: Given %s with long names on a 375px screen, When it settles, Then nothing runs past the screen',
  async (_name, path, signedIn) => {
    const page = await open(path(), 375, signedIn)
    expect(await page.evaluate(overflow)).toBe(0)
    const wide = await page.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter(
          (element) =>
            element.checkVisibility() &&
            element.getBoundingClientRect().right > 375.5,
        )
        .map((element) => `${element.tagName}.${element.className}`)
        .slice(0, 5),
    )
    expect(wide).toEqual([])
    await page.close()
  },
  20000,
)

test.each([
  [1280, 16],
  [375, 8],
])(
  'F29-AC21: Given the event page on a %ipx screen, When it settles, Then the default cover shows two rows of %i whole squares',
  async (width, across) => {
    const page = await open(`/events/${eventId}`, width, false)
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('.cover-pattern > span')]
        .filter((element) => element.checkVisibility())
        .map((element) => element.getBoundingClientRect())
        .map((box) => ({
          top: Math.round(box.top),
          right: box.right,
          w: box.width,
          h: box.height,
        })),
    )
    expect(boxes).toHaveLength(across * 2)
    expect(new Set(boxes.map((box) => box.top)).size).toBe(2)
    for (const box of boxes) {
      expect(Math.abs(box.w - box.h)).toBeLessThan(1)
      expect(box.right).toBeLessThanOrEqual(width)
    }
    await page.close()
  },
  20000,
)

test.each([1280, 375])(
  'F29-AC27: Given the event page on a %ipx screen, When it settles, Then its cover starts 40px below the line under the site header',
  async (width) => {
    const page = await open(`/events/${eventId}`, width, false)
    const gap = await page.evaluate(() => {
      const header = document.querySelector('.site-header')!
      const cover = document.querySelector('.event-page > .cover-pattern')!
      return (
        cover.getBoundingClientRect().top -
        header.getBoundingClientRect().bottom
      )
    })
    expect(Math.round(gap)).toBeGreaterThanOrEqual(40)
    await page.close()
  },
  20000,
)
