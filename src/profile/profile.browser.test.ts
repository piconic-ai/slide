import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser } from 'playwright'
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
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

// WebKit's interceptor omits the session cookie it sends on the network.
test.skipIf(process.env.BROWSER === 'webkit')(
  'F21-AC7: Given a signed-in reader at 390px without JavaScript, When they press Follow on a profile, Then they return to it with an Unfollow button and no horizontal overflow',
  async () => {
    const accountsEnv = withInvited(env)
    await signIn(accountsEnv, 'speaker', {
      id: INVITED_ID,
      name: 'W'.repeat(50),
    })
    const cookie = await signIn(accountsEnv)
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      javaScriptEnabled: false,
      locale: 'en-US',
    })
    try {
      await page.context().addCookies([
        {
          name: '__Host-slide_owner',
          value: cookie.split('=')[1] ?? '',
          url: TEST_ORIGIN,
          secure: true,
          httpOnly: true,
        },
      ])
      const profile = `${TEST_ORIGIN}/@speaker`
      await page.route(`${TEST_ORIGIN}/**`, async (route) => {
        const request = route.request()
        const headers = await request.allHeaders()
        // Chromium adds Sec-Fetch-Site after interception.
        if (request.method() === 'POST' && request.frame().url() === profile)
          headers['sec-fetch-site'] ??= 'same-origin'
        const response = await server.fetch(
          new Request(request.url(), {
            method: request.method(),
            headers,
            body: request.postData(),
          }),
          accountsEnv,
        )
        if (response.status === 303) {
          // Playwright skips routing the next GET of an HTTP redirect.
          return route.fulfill({
            status: 200,
            contentType: 'text/html',
            headers: { Refresh: `0; url=${response.headers.get('Location')}` },
            body: '',
          })
        }
        return route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        })
      })
      await page.goto(profile)
      const width = () =>
        page.evaluate(() => document.documentElement.scrollWidth)
      expect(await width()).toBeLessThanOrEqual(390)
      const heading = page.locator('.profile')
      await heading.getByRole('button', { name: 'Follow', exact: true }).click()
      const release = heading.getByRole('button', {
        name: 'Unfollow',
        exact: true,
      })
      await expect.poll(() => release.isVisible(), SETTLE).toBe(true)
      // Until hover or focus, the button shows the state, not the action.
      expect(await release.locator('.state').isVisible()).toBe(true)
      expect(await release.locator('.state').textContent()).toBe('Following')
      const idle = await release.boundingBox()
      await release.hover()
      expect(await release.locator('.act').isVisible()).toBe(true)
      expect(page.url()).toBe(profile)
      expect(await width()).toBeLessThanOrEqual(390)
      // The label change must not shrink the button under the pointer: its
      // right edge still unfollows.
      if (!idle) throw new Error('The following button has no box')
      const edge = { x: idle.x + idle.width - 4, y: idle.y + idle.height / 2 }
      await page.mouse.move(edge.x, edge.y)
      expect((await release.boundingBox())?.width).toBe(idle.width)
      await page.mouse.click(edge.x, edge.y)
      await expect
        .poll(
          () =>
            heading
              .getByRole('button', { name: 'Follow', exact: true })
              .isVisible(),
          SETTLE,
        )
        .toBe(true)
    } finally {
      await page.close()
    }
  },
  30000,
)
