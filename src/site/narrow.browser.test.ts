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

test('F03-AC11: Given one slide’s page, When the screen is wide, Then it has two columns, and on a 375px screen one column with the publication box first', async () => {
  const tops = async (width: number) => {
    const page = await open('/slides/talk', width, true)
    const boxes = await page.evaluate(() =>
      ['.deck-main', '.deck-side'].map((selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect()
        return {
          left: Math.round(box?.left ?? -1),
          top: Math.round(box?.top ?? -1),
        }
      }),
    )
    await page.close()
    return boxes
  }
  const [wideMain, wideSide] = await tops(1280)
  expect(wideSide.left).toBeGreaterThan(wideMain.left)
  expect(wideSide.top).toBe(wideMain.top)
  const [narrowMain, narrowSide] = await tops(375)
  expect(narrowSide.left).toBe(narrowMain.left)
  expect(narrowSide.top).toBeLessThan(narrowMain.top)
})

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
