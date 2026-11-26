import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = withInvited(testEnv(platform.env))

let browser: Browser
let alice = ''
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  alice = await signIn(env, 'alice')
  await signIn(env, 'bob', { id: INVITED_ID })
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

test.each([375, 1280])(
  'F32-AC21: Given Alice on Bob’s profile at %ipx, When she opens the ⋯ menu, Then the menu stays within the screen',
  async (width) => {
    const page = await browser.newPage({
      viewport: { width, height: 800 },
      locale: 'ja-JP',
    })
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== TEST_ORIGIN) return route.abort()
      const { origin: _origin, ...headers } = await route.request().allHeaders()
      headers.cookie = alice
      const response = await server.fetch(new Request(url, { headers }), env)
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      })
    })
    await page.goto(`${TEST_ORIGIN}/@bob`)
    await page.locator('.profile-menu > summary').click()
    const item = page.getByRole('link', { name: 'この人をブロック' })
    await expect.poll(() => item.isVisible()).toBe(true)
    const box = await page.locator('.profile-menu .menu-items').boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    await page.close()
  },
  20000,
)
