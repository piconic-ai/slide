import { readFile } from 'node:fs/promises'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { TEST_ORIGIN, testEnv } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)

const SETTLE = { timeout: 10_000 }
let browser: Browser
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

/** A page whose requests the app answers, with the script of every page. */
async function open(path: string) {
  const page = await browser.newPage({ locale: 'ja-JP' })
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
