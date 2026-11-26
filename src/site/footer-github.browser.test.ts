import { openTestBrowser } from '../test-open-browser'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Browser, Page } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import {
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

// The top page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

const REPOSITORY = 'https://github.com/piconic-ai/slide'
const SHOTS = process.env.FOOTER_SHOTS

let browser: Browser
let cookie = ''
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  cookie = await signIn(env)
  await seedPublic(platform.env.DB, 'talk', 1, 'Talk')
  browser = await openTestBrowser()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

/** A page answered by the Worker; GitHub is answered by a stand-in. */
async function open(
  path: string,
  width: number,
  options: { signedIn?: boolean; locale?: string } = {},
) {
  const page = await browser.newPage({
    viewport: { width, height: 800 },
    locale: options.locale ?? 'ja-JP',
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === 'https://github.com')
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>github</title>',
      })
    if (url.origin !== TEST_ORIGIN) return route.abort()
    // Miniflare's local proxy refuses an Origin outside its own hostnames.
    const { origin: _origin, ...headers } = await route.request().allHeaders()
    if (options.signedIn) headers.cookie = cookie
    const response = await server.fetch(new Request(url, { headers }), env)
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}${path}`)
  await page
    .locator(
      options.signedIn ? '[data-account] .avatar' : '[data-account] .sign-in',
    )
    .waitFor()
  if (path === '/') {
    await page.locator('.recent-body a.card-title').first().waitFor()
    if (options.signedIn)
      // The following tab is hidden behind recent slides, but its list
      // still settles before the page is measured.
      await page
        .locator('.home-following .home-room-note')
        .waitFor({ state: 'attached' })
  }
  if (SHOTS) await page.waitForLoadState('networkidle')
  return page
}

const repositoryLink = (page: Page) =>
  page.locator('.site-footer a.github-link')

const PAGES: readonly [name: string, path: string, signedIn: boolean][] = [
  ['the top page', '/', false],
  ['the top page, signed in', '/', true],
  ['a profile', '/@owner', false],
  ['the help', '/help', false],
  ['a page that does not exist', '/no-such-page', false],
  ['the settings', '/settings', true],
]

test.each(PAGES)(
  'F03-AC92: Given %s on a 1280px screen, When it settles, Then the GitHub mark is in the footer',
  async (name, path, signedIn) => {
    const page = await open(path, 1280, { signedIn })
    const link = repositoryLink(page)
    expect(await link.isVisible()).toBe(true)
    if (SHOTS)
      await page.screenshot({
        path: `${SHOTS}/${name.replace(/\W+/g, '-')}-1280.png`,
      })
    await page.close()
  },
)

test('F03-AC94: Given the footer at 375px and 1280px, When the link is drawn and reached by Tab, Then its target is at least 44px square, stays on screen and shows a focus outline', async () => {
  const page = await open('/help', 375)
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    const box = await repositoryLink(page).boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/help-${width}.png` })
    if (SHOTS && width === 375)
      await page.screenshot({
        path: `${SHOTS}/help-375-full.png`,
        fullPage: true,
      })
  }
  const link = repositoryLink(page)
  for (let index = 0; index < 60; index++) {
    await page.keyboard.press('Tab')
    if (await link.evaluate((element) => element === document.activeElement))
      break
  }
  expect(await link.evaluate((el) => el === document.activeElement)).toBe(true)
  const outline = await link.evaluate((el) => {
    const style = getComputedStyle(el)
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
  })
  expect(outline.style).not.toBe('none')
  expect(outline.width).toBeGreaterThan(0)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/help-focus-1280.png` })
  await page.close()
})

test.each([
  ['/help', 'ja-JP', 'GitHub のリポジトリ'],
  ['/help?lang=en', 'en-US', 'GitHub repository'],
] as const)(
  'F03-AC93: Given %s, When it opens, Then the accessible name of the link is "%s"',
  async (path, locale, name) => {
    const page = await open(path, 1280, { locale })
    expect(
      await page.getByRole('link', { name, exact: true }).getAttribute('href'),
    ).toBe(REPOSITORY)
    await page.close()
  },
)

test.each(['/help', '/'])(
  'F03-AC95: Given %s opened with the router, When the link is pressed, Then the whole page moves to GitHub in the same tab',
  async (path) => {
    const page = await open(path, 1280)
    // A mark that only the page that is left holds: a router move keeps it.
    await page.evaluate(() => {
      ;(window as unknown as { left: boolean }).left = true
    })
    const pages = page.context().pages().length
    await Promise.all([
      page.waitForURL(`${REPOSITORY}`),
      repositoryLink(page).click(),
    ])
    expect(page.context().pages().length).toBe(pages)
    expect(await page.title()).toBe('github')
    expect(
      await page.evaluate(() => (window as unknown as { left?: boolean }).left),
    ).toBeUndefined()
    await page.close()
  },
)
