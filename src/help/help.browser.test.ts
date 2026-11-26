import { openTestBrowser } from '../test-open-browser'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Browser, BrowserContext } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { TEST_ORIGIN, testEnv } from '../publication/test-support'
import { HELP_AIMS } from './aims'
import { HELP_CATALOG } from './default-catalog'

// The top page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)

let browser: Browser
beforeAll(async () => {
  browser = await openTestBrowser()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

/** Answers the page's requests from the Worker; nothing leaves the machine. */
async function answerFromWorker(context: BrowserContext) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    // Miniflare's local proxy refuses an Origin outside its own hostnames.
    const { origin: _origin, ...headers } = await route.request().allHeaders()
    const response = await server.fetch(new Request(url, { headers }), env)
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
}

async function open(path: string, width: number, javaScript = true) {
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    locale: 'ja-JP',
    javaScriptEnabled: javaScript,
  })
  await answerFromWorker(context)
  const page = await context.newPage()
  await page.goto(`${TEST_ORIGIN}${path}`)
  return page
}

test('F36-AC29: Given the entrance at 1280px and at 375px, When it is drawn, Then the aims are two columns, then one', async () => {
  for (const [width, columns] of [
    [1280, 2],
    [375, 1],
  ] as const) {
    const page = await open('/help', width)
    const measured = await page.evaluate(() => {
      const aims = [...document.querySelectorAll('.help-aim')]
      const lefts = new Set(
        aims.map((aim) => Math.round(aim.getBoundingClientRect().left)),
      )
      return { aims: aims.length, columns: lefts.size }
    })
    expect(measured).toEqual({ aims: HELP_AIMS.length, columns })
    await page.close()
  }
})

const PAGES = [
  '/help',
  '/help?q=zip',
  '/help?q=nothing-here-xyz',
  `/help?q=${'あ'.repeat(200)}`,
  '/help/start',
  '/help/safety',
  '/help/slides/upload',
  '/help/community/link-rules',
  '/help/sharing/embed-in-blog',
  '/help/safety/external-access',
  '/help/bot',
] as const

test.each(PAGES)(
  'F36-AC29: Given %s at 375px, When it is drawn, Then nothing runs past the screen',
  async (path) => {
    const page = await open(path, 375)
    const measured = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      wide: [...document.querySelectorAll('main *')]
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

test('F36-AC29: Given every article at 375px, When it is drawn, Then none runs past the screen', async () => {
  const page = await open('/help', 375)
  for (const entry of HELP_CATALOG) {
    await page.goto(`${TEST_ORIGIN}${entry.path}`)
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    )
    expect([entry.path, scrollWidth]).toEqual([entry.path, 375])
  }
  await page.close()
}, 60000)

test('F36-AC1: Given a reader whose browser runs no script, When the word is sent from the search box, Then the results are shown', async () => {
  const page = await open('/help', 1280, false)
  await page.locator('input[type="search"]').fill('zip')
  await Promise.all([
    page.waitForURL(`${TEST_ORIGIN}/help?q=zip`),
    page.getByRole('button', { name: '探す' }).click(),
  ])
  expect(await page.locator('h2').first().innerText()).toContain('zipの記事')
  expect(await page.locator('mark').first().innerText()).toBe('zip')
  await page.close()
})

test('F36-AC41: Given the links on the entrance, When they are measured, Then each is at least 44px tall to press', async () => {
  const page = await open('/help', 375)
  const heights = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '.help-aim > h2 a, .help-links a, .help-contact a',
      ),
    ].map((link) => link.getBoundingClientRect().height),
  )
  expect(heights.length).toBeGreaterThan(8)
  // The sentence of the contact line is text with a link in it; the lists are rows.
  for (const height of heights.slice(0, -1))
    expect(height).toBeGreaterThanOrEqual(44)
  await page.close()
})

test('F36-AC6: Given an article, When its breadcrumbs are read, Then the current page is marked and the others lead up the three levels', async () => {
  const page = await open('/help/start/sign-in', 1280)
  const crumbs = await page.evaluate(() =>
    [...document.querySelectorAll('.help-crumbs li')].map((item) => [
      item.textContent?.trim(),
      item.querySelector('a')?.getAttribute('href') ?? null,
      item.getAttribute('aria-current'),
    ]),
  )
  expect(crumbs).toEqual([
    ['ヘルプ', '/help', null],
    ['はじめる', '/help/start', null],
    ['ログインする', null, 'page'],
  ])
  await page.close()
})

test('F36-AC29: Given an article at 1280px, When it is drawn, Then its text keeps to 40em', async () => {
  const page = await open('/help/community/create-community', 1280)
  const widest = await page.evaluate(() =>
    Math.max(
      ...[
        ...document.querySelectorAll('.help-article p, .help-article li'),
      ].map((element) => element.getBoundingClientRect().width),
    ),
  )
  expect(widest).toBeGreaterThan(0)
  expect(widest).toBeLessThanOrEqual(40 * 16 + 1)
  await page.close()
})
