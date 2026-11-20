import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

// The top page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

// Words with no place to break, as titles and descriptions sometimes are.
const LONG =
  'Supercalifragilisticexpialidocious_and_a_very_long_unbroken_title_of_slides'
const LONG_JA =
  'とても長い題名のスライドで、折り返さなければ画面の幅をこえてしまうもの'.repeat(
    2,
  )

let browser: Browser
let cookie = ''
beforeAll(async () => {
  await applyMigrations(db)
  // Signing in records the handle "owner" from the stubbed GitHub login.
  cookie = await signIn(env)
  const talk = await seedPublic(db, 'talk', 100, LONG)
  await drizzle(db)
    .update(deployments)
    .set({ description: `${LONG} ${LONG_JA}` })
    .where(eq(deployments.id, talk))
  for (let index = 0; index < 5; index++)
    await seedPublic(db, `more-${index}`, 10 + index, LONG_JA)
  await seedDeck(db, 'draft')
  await seedDeployment(db, 'draft')
  await seedDeployment(db, 'draft', 'failed')
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

/** A page of the service at the given width, answered by the Worker. */
async function open(path: string, width: number, signedIn: boolean) {
  const page = await browser.newPage({
    viewport: { width, height: 800 },
    locale: 'ja-JP',
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    // Covers and the deck itself are not needed to measure the frame.
    if (url.origin !== TEST_ORIGIN) return route.abort()
    // Miniflare's local proxy refuses an Origin outside its own hostnames.
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
  return page
}

const PAGES: readonly [name: string, path: string, signedIn: boolean][] = [
  ['the top page', '/', false],
  ['the top page, signed in', '/', true],
  ['the viewer', '/@owner/talk', false],
  ['the viewer, signed in', '/@owner/talk', true],
  ['a profile', '/@owner', false],
  ['the list of slides', '/slides', true],
  ['one public slide', '/slides/talk', true],
  ['one draft slide', '/slides/draft', true],
  ['the settings', '/settings', true],
]

test.each(PAGES)(
  'F03-AC11: Given %s with long, unbroken titles on a 375px screen, When it settles, Then nothing runs past the screen',
  async (_name, path, signedIn) => {
    const page = await open(path, 375, signedIn)
    await page.waitForLoadState('networkidle')
    const measured = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      // What sticks out, to name it when the test fails.
      wide: [...document.querySelectorAll('body *')]
        // A closed menu's items keep a box but are not drawn.
        .filter(
          (element) =>
            element.checkVisibility() &&
            element.getBoundingClientRect().right > 375.5,
        )
        .map((element) =>
          `${element.tagName.toLowerCase()}.${element.className}`.slice(0, 60),
        )
        .slice(0, 5),
    }))
    expect(measured).toEqual({ scrollWidth: 375, wide: [] })
    await page.close()
  },
  20000,
)

test.each([1280, 375])(
  'F03-AC38: Given a row of the list of slides on a %ipx screen, When it settles, Then the name and “edit” are each at least 44px tall to press',
  async (width) => {
    const page = await open('/slides', width, true)
    await page.waitForLoadState('networkidle')
    const heights = await page.evaluate(() =>
      ['.deck-row-name a', '.deck-row-edit'].map(
        (selector) =>
          document.querySelector(selector)?.getBoundingClientRect().height ?? 0,
      ),
    )
    expect(heights.every((height) => height >= 44)).toBe(true)
    await page.close()
  },
  20000,
)

test.each([1280, 375])(
  'F03-AC40: Given one slide’s page on a %ipx screen, When it settles, Then the frames stack in one column in the same order and nothing runs past the screen',
  async (width) => {
    const page = await open('/slides/talk', width, true)
    const boxes = await page.evaluate(() =>
      ['title', 'publication', 'share-url', 'replace', 'delete'].map((name) => {
        const box = document
          .querySelector(`[data-deck-frame="${name}"]`)
          ?.getBoundingClientRect()
        return {
          name,
          left: Math.round(box?.left ?? -1),
          top: Math.round(box?.top ?? -1),
          right: Math.round(box?.right ?? -1),
        }
      }),
    )
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    )
    await page.close()
    expect(scrollWidth).toBe(width)
    expect(boxes.every((box) => box.left === boxes[0]?.left)).toBe(true)
    expect(boxes.map((box) => box.top)).toEqual(
      [...boxes.map((box) => box.top)].sort((a, b) => a - b),
    )
    expect(new Set(boxes.map((box) => box.top)).size).toBe(boxes.length)
  },
  20000,
)

test.each([1280, 375])(
  'F03-AC8: Given the viewer on a %ipx screen, When the reader uses the actions, Then there are three, each menu opens alone, says so, stays on the screen, and closes on a press outside or Escape',
  async (width) => {
    const page = await open('/@owner/talk', width, false)
    const actions = page.locator('.viewer-actions')
    const share = actions.locator('details.share-menu')
    const more = actions.locator('details.more-menu')
    // Full screen is hidden where the browser cannot do it; it is counted
    // by its place in the markup.
    expect(
      await actions.locator(':scope > button, :scope > details').count(),
    ).toBe(3)
    expect(
      (await actions.locator(':scope > button').textContent())?.trim(),
    ).toBe('全画面')

    const expanded = (menu: typeof share) =>
      menu.locator('summary').getAttribute('aria-expanded')
    const onScreen = async (menu: typeof share) => {
      const box = await menu.locator('.menu-items').boundingBox()
      return !!box && box.x >= 0 && box.x + box.width <= width
    }

    await share.locator('summary').click()
    await expect.poll(() => expanded(share)).toBe('true')
    expect(
      await share.getByRole('button', { name: 'URL をコピー' }).isVisible(),
    ).toBe(true)
    expect(await onScreen(share)).toBe(true)

    // Opening the other menu closes this one.
    await more.locator('summary').click()
    await expect.poll(() => expanded(more)).toBe('true')
    await expect.poll(() => expanded(share)).toBe('false')
    const report = more.getByRole('link', { name: '通報する' })
    expect(await report.isVisible()).toBe(true)
    expect((await report.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    expect(await onScreen(more)).toBe(true)

    // Escape closes it and hands the focus back to its button.
    await page.keyboard.press('Escape')
    await expect.poll(() => expanded(more)).toBe('false')
    expect(
      await more
        .locator('summary')
        .evaluate((summary) => summary === document.activeElement),
    ).toBe(true)

    // A press outside closes it.
    await share.locator('summary').click()
    await expect.poll(() => expanded(share)).toBe('true')
    await page.locator('.viewer-title h1').click()
    await expect.poll(() => expanded(share)).toBe('false')
    expect(await share.locator('.menu-items').isVisible()).toBe(false)

    // Each thing to press is at least 44px tall.
    for (const target of [share.locator('summary'), more.locator('summary')])
      expect((await target.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await page.close()
  },
  20000,
)

test.each([
  ['/help', 'ja'],
  ['/help?lang=en', 'en'],
])(
  'F03-AC23: Given the help %s on a 375px screen, When it settles, Then nothing runs past the screen, the contents sit above the text, and each item is 44px tall and leads to its section',
  async (path) => {
    const page = await open(path, 375, false)
    await page.waitForLoadState('networkidle')
    const measured = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      wide: [...document.querySelectorAll('body *')]
        .filter(
          (element) =>
            element.checkVisibility() &&
            element.getBoundingClientRect().right > 375.5,
        )
        .map((element) =>
          `${element.tagName.toLowerCase()}.${element.className}`.slice(0, 60),
        )
        .slice(0, 5),
    }))
    expect(measured).toEqual({ scrollWidth: 375, wide: [] })
    const toc = await page.locator('.help-toc').boundingBox()
    const body = await page.locator('.help-body').boundingBox()
    expect(toc && body && toc.y + toc.height <= body.y + 1).toBe(true)
    const links = page.locator('.help-toc a')
    expect(await links.count()).toBe(9)
    for (const link of await links.all())
      expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await links.nth(3).click()
    await expect.poll(() => page.url()).toContain('#embed')
    await page.close()
  },
  20000,
)

test('F03-AC23: Given the help on a 1280px screen, When it settles, Then the contents are on the left of the text, side by side, and the text keeps to 40em', async () => {
  const page = await open('/help', 1280, false)
  await page.waitForLoadState('networkidle')
  const toc = await page.locator('.help-toc').boundingBox()
  const body = await page.locator('.help-body').boundingBox()
  expect(toc && body && toc.x + toc.width <= body.x).toBe(true)
  expect(toc?.y).toBeLessThan((body?.y ?? 0) + 100)
  const widest = await page.evaluate(() =>
    Math.max(
      ...[...document.querySelectorAll('.help-body p')].map(
        (paragraph) => paragraph.getBoundingClientRect().width,
      ),
    ),
  )
  expect(widest).toBeLessThanOrEqual(40 * 16 + 1)
  await page.close()
})
