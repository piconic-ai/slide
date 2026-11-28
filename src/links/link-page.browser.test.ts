import { readFile } from 'node:fs/promises'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { eventRefOf } from '../events/event-url'
import {
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { linkPagePath } from './link-address'
import { addLink } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)

// Words with no place to break, as titles sometimes are.
const LONG =
  'Supercalifragilisticexpialidocious_and_a_very_long_unbroken_event_name_x'
// An event with a long title and a group with no community, and two whose
// headings are their long addresses. Event 410635 is left with no slides.
const SOURCE = 'https://kanagawapm.connpass.com/event/410636/'
const URLS = [
  SOURCE,
  'https://luma.com/a-very-long-luma-event-name-without-any-break-at-all-0123456789',
  'https://peatix.com/event/1234567890/view/with/a/long/path/that/does/not/break',
] as const
const PAGES = URLS.map((url) => linkPagePath(eventRefOf(url)!.url))

const SETTLE = { timeout: 10_000 }
let browser: Browser
let cookie = ''
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  cookie = await signIn(env)
  for (let index = 0; index < 4; index++)
    await seedPublic(platform.env.DB, `talk-${index}`, 100 + index, LONG)
  const links = [...URLS.entries()].map(([index, url]) => [0, url, index])
  for (const [deck, url, index] of [...links, [1, SOURCE, 1], [2, SOURCE, 1]])
    await addLink(platform.env.DB, {
      deckId: `talk-${deck}`,
      ownerUserId: OWNER_ID,
      link: {
        kind: 'event',
        url: String(url),
        title: index === 0 ? LONG : null,
        event: eventRefOf(String(url))!,
      },
      now: 1,
    })
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

type Opening = Readonly<{
  width?: number
  signedIn?: boolean
  javaScriptEnabled?: boolean
}>

/** A page whose requests the app answers, with the script of every page. */
async function open(path: string, opening: Opening = {}) {
  const page = await browser.newPage({
    locale: 'ja-JP',
    viewport: { width: opening.width ?? 1280, height: 800 },
    javaScriptEnabled: opening.javaScriptEnabled ?? true,
  })
  const asked: string[] = []
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    if (url.pathname === '/share.js')
      return route.fulfill({
        contentType: 'text/javascript',
        body: await readFile('public/share.js'),
      })
    asked.push(route.request().url().slice(TEST_ORIGIN.length))
    const { origin: _origin, ...headers } = await route.request().allHeaders()
    if (opening.signedIn) headers.cookie = cookie
    const response = await server.fetch(new Request(url, { headers }), env)
    const moved = response.headers.get('Location')
    await route.fulfill({
      // A redirect given to the browser here would leave the test's hands,
      // so the browser is told to go on by itself, cookies kept.
      status: moved ? 200 : response.status,
      headers: {
        ...Object.fromEntries(response.headers),
        ...(moved ? { Refresh: `0; url=${moved}` } : {}),
      },
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}${path}`)
  return { page, asked }
}

test('F45-AC31: Given an address pasted whole after /link/, When a browser opens it, Then the `//` arrives as written and the browser ends at the one path', async () => {
  const { page, asked } = await open(
    '/link/https://connpass.com/event/410635/?utm_source=x',
  )
  expect(asked[0]).toBe('/link/https://connpass.com/event/410635/?utm_source=x')
  await expect
    .poll(
      () =>
        page
          .locator('h1')
          .textContent()
          .catch(() => ''),
      SETTLE,
    )
    .toBe('この URL の集まりは、まだありません')
  expect(page.url()).toBe(`${TEST_ORIGIN}/link/connpass.com/event/410635`)
})

test("F45-AC34: Given a /link/ page whose address has its own lang, When the footer's English is pressed, Then the same page is shown in English and the address keeps its query", async () => {
  const path = '/link/example.com/a?b=%E3%81%82&lang=ja'
  const { page } = await open(path)
  await page.locator('.site-footer a[hreflang="en"]').click()
  await expect
    .poll(() => page.locator('html').getAttribute('lang'), SETTLE)
    .toBe('en')
  expect(page.url()).toBe(`${TEST_ORIGIN}${path}`)
  expect(await page.locator('.link-missing-address').textContent()).toBe(
    'https://example.com/a?b=%E3%81%82&lang=ja',
  )
})

test.each(
  [1280, 375].flatMap((width) =>
    [
      ...PAGES.map((path) => [path, false] as const),
      [`/link/example.com/${LONG}/${LONG}?${LONG}=${LONG}`, false] as const,
      // F29-AC31: the related links of one slide, with the same long names.
      ['/my/slides/talk-0', true] as const,
    ].map(([path, signedIn]) => [width, path, signedIn] as const),
  ),
)(
  'F45-AC21: F29-AC31: Given a %ipx screen and long names and addresses, When %s settles, Then nothing runs past the screen',
  async (width, path, signedIn) => {
    const { page } = await open(path, { width, signedIn })
    await page.waitForLoadState('networkidle')
    const past = await page.evaluate((screen) => {
      const root = document.documentElement
      return {
        overflow: root.scrollWidth - root.clientWidth,
        wide: [...document.querySelectorAll('body *')]
          .filter(
            (element) =>
              element.checkVisibility() &&
              element.getBoundingClientRect().right > screen + 0.5,
          )
          .map((element) => `${element.tagName}.${element.className}`)
          .slice(0, 5),
      }
    }, width)
    expect(past).toEqual({ overflow: 0, wide: [] })
    await page.close()
  },
  20000,
)

test('F45-AC21: Given the pages of the long names, When they open, Then they are the page with the long heading and the offer of a community, the pages headed by an address, and the page of no gathering', async () => {
  const texts = async (path: string) => {
    const { page } = await open(path)
    const read = [
      await page.locator('h1').textContent(),
      await page.locator('.event-community-prompt').count(),
    ]
    await page.close()
    return read
  }
  expect(await texts(PAGES[0]!)).toEqual([LONG, 1])
  expect(await texts(PAGES[1]!)).toEqual([`Luma ${URLS[1]}`, 0])
  expect(await texts(PAGES[2]!)).toEqual([`peatix.com ${URLS[2]}`, 0])
  expect((await texts(`/link/example.com/${LONG}`))[0]).toBe(
    'この URL の集まりは、まだありません',
  )
})

test('F45-AC30: Given scripts running, When the way to the address’s own page is pressed, Then the check opens with the address, to open or not, and the page stays', async () => {
  const { page } = await open(PAGES[0]!)
  await page.getByRole('link', { name: 'connpass で見る' }).click()
  const dialog = page.getByRole('dialog')
  await expect.poll(() => dialog.isVisible(), SETTLE).toBe(true)
  expect(await dialog.locator('[data-link-check-url]').textContent()).toBe(
    SOURCE,
  )
  expect(page.url()).toBe(`${TEST_ORIGIN}${PAGES[0]}`)
  expect(
    await dialog.getByRole('link', { name: '開く' }).getAttribute('href'),
  ).toBe(SOURCE)
  await page.close()
})

test('F45-AC30: Given scripts turned off, When the way to the address’s own page is pressed, Then the reader goes there at once', async () => {
  const { page } = await open(PAGES[0]!, { javaScriptEnabled: false })
  await page.route(SOURCE, (route) => route.fulfill({ body: 'the event' }))
  await page.getByRole('link', { name: 'connpass で見る' }).click()
  await expect.poll(() => page.url(), SETTLE).toBe(SOURCE)
  await page.close()
})

test.each([1280, 375])(
  'F45-AC17: Given a link in no community on a %ipx screen, When its page settles, Then with no cover its heading starts 40px or more below the line under the site header',
  async (width) => {
    const { page } = await open(PAGES[1]!, { width })
    const gap = await page.evaluate(() => {
      const header = document.querySelector('.site-header')!
      const heading = document.querySelector('.event-page h1')!
      return (
        heading.getBoundingClientRect().top -
        header.getBoundingClientRect().bottom
      )
    })
    expect(Math.round(gap)).toBeGreaterThanOrEqual(40)
    expect(await page.locator('.cover-pattern, .cover-image').count()).toBe(0)
    await page.close()
  },
  20000,
)
