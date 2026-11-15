import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import { signIn, TEST_ORIGIN, testEnv } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
let browser: Browser
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

// Other browser tests run at the same time.
const SETTLE = { timeout: 10000 }
const AVATAR = 'https://avatars.githubusercontent.com/u/722500?v=4'
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

test('Given a synced author, When a reader opens their profile, Then the page policy lets the picture load from GitHub, without sending where the reader is', async () => {
  await signIn(env, 'owner', { profile: { avatar_url: AVATAR } })
  const page = await browser.newPage()
  const errors: string[] = []
  const pictures: Record<string, string>[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.href === AVATAR) {
      pictures.push(await route.request().allHeaders())
      return route.fulfill({ contentType: 'image/png', body: PIXEL })
    }
    if (url.origin !== TEST_ORIGIN) return route.abort()
    const response = await server.fetch(new Request(url), env)
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}/@owner`)
  const picture = page.locator('.profile img.portrait')
  await expect
    .poll(
      () => picture.evaluate((img: HTMLImageElement) => img.naturalWidth),
      SETTLE,
    )
    .toBe(1)
  expect(pictures).toHaveLength(1)
  expect(pictures[0]?.referer).toBeUndefined()
  expect(errors).toEqual([])
  await page.close()
})
