import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
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
  browser = await chromium.launch()
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
  await page.waitForLoadState('networkidle')
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
    expect(await link.count()).toBe(1)
    expect(await link.isVisible()).toBe(true)
    expect(await link.getAttribute('href')).toBe(REPOSITORY)
    if (SHOTS)
      await page.screenshot({
        path: `${SHOTS}/${name.replace(/\W+/g, '-')}-1280.png`,
      })
    await page.close()
  },
)

test('F03-AC92: Given the viewer, When it opens, Then the footer outside the frame has the mark and the frame does not', async () => {
  const page = await open('/@owner/talk', 1280)
  expect(await repositoryLink(page).count()).toBe(1)
  const inFrame = await page
    .locator('iframe')
    .evaluateAll(
      (frames) =>
        frames.filter((frame) => frame.closest('.site-footer')).length,
    )
  expect(inFrame).toBe(0)
  await page.close()
})

test.each([1280, 375])(
  'F03-AC94: Given a %ipx screen, When the footer is drawn, Then the link is a square of 44px or more and sits inside the screen',
  async (width) => {
    const page = await open('/help', width)
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
    await page.close()
  },
)

test('F03-AC94: Given the footer, When Tab is pressed through the page, Then the link is reached and shows a focus outline', async () => {
  const page = await open('/help', 1280)
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
