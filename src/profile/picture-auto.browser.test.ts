import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser, type Page, type Route } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { PICTURE_MAX_BYTES } from './picture-policy'
import { png } from './test-picture'
import {
  OWNER_ID,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
let browser: Browser
let cookie = ''

beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  cookie = await signIn(env, 'owner', { name: 'Owner' })
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

const SETTLE = { timeout: 15000 }

/** Opens settings with the Worker answering the browser; counts the uploads sent. */
async function settingsPage(javaScript = true) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 800 },
    locale: 'ja-JP',
    javaScriptEnabled: javaScript,
  })
  await context.addCookies([
    {
      name: '__Host-slide_owner',
      value: cookie.split('=')[1] ?? '',
      url: TEST_ORIGIN,
      secure: true,
      httpOnly: true,
    },
  ])
  const uploads: string[] = []
  await context.route('**/*', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    if (request.method() === 'POST' && url.pathname === '/settings/picture')
      uploads.push(url.pathname)
    const { origin: _origin, ...headers } = await request.allHeaders()
    if (request.method() === 'POST') headers['sec-fetch-site'] = 'same-origin'
    const body = request.postDataBuffer()
    const response = await server.fetch(
      new Request(url, {
        method: request.method(),
        headers: {
          ...headers,
          ...(request.method() === 'POST' ? { Origin: TEST_ORIGIN } : {}),
        },
        body:
          body && request.method() !== 'GET' ? new Uint8Array(body) : undefined,
        redirect: 'manual',
      }),
      env,
    )
    // Playwright does not follow a redirect it fulfils; say where to go.
    if (response.status === 303)
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { Refresh: `0; url=${response.headers.get('Location')}` },
        body: '',
      })
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  const page = await context.newPage()
  await page.goto(`${TEST_ORIGIN}/settings`)
  return { page, context, uploads }
}

const stored = async () =>
  (await platform.env.UPLOADS.list({ prefix: 'avatars/' })).objects.length

const file = (data: Uint8Array | Buffer, name: string, mimeType: string) => ({
  name,
  mimeType,
  buffer: Buffer.from(data),
})

const pick = (page: Page) => page.getByLabel('画像を選ぶ')

test.skipIf(process.env.BROWSER === 'webkit')(
  'F28-AC85 F28-AC41: Given scripts run, When a PNG is chosen, Then it is sent at once with no button pressed, the upload button is not shown, and the picture changes',
  async () => {
    await platform.env.UPLOADS.delete(`avatars/${OWNER_ID}`)
    const { page, context, uploads } = await settingsPage()
    try {
      await expect
        .poll(() => page.locator('[data-picture-submit]').isHidden(), SETTLE)
        .toBe(true)
      await pick(page).setInputFiles(
        file(png(300, 200), 'face.png', 'image/png'),
      )
      await expect
        .poll(() => page.url(), SETTLE)
        .toContain('/settings?saved=picture')
      await expect
        .poll(
          () => page.getByText('プロフィール画像を変えました。').isVisible(),
          SETTLE,
        )
        .toBe(true)
      expect(uploads).toHaveLength(1)
      expect(await stored()).toBe(1)
      expect(
        await page.locator('.settings-face img').getAttribute('src'),
      ).toMatch(/\/avatars\/\d+\?v=\d+/)
    } finally {
      await context.close()
    }
  },
  45000,
)

test.skipIf(process.env.BROWSER === 'webkit')(
  'F28-AC86 F28-AC42 F28-AC43: Given scripts run, When a GIF, then a file over 1 MB is chosen, Then nothing is sent, the reason shows under the field in the page’s own words, and the field is cleared',
  async () => {
    await platform.env.UPLOADS.delete(`avatars/${OWNER_ID}`)
    const { page, context, uploads } = await settingsPage()
    try {
      const notice = page.locator('#picture-client-error')
      await pick(page).setInputFiles(
        file(Buffer.from('GIF89a......'), 'x.gif', 'image/gif'),
      )
      await expect.poll(() => notice.isVisible(), SETTLE).toBe(true)
      expect(await notice.textContent()).toContain(
        'PNG、JPEG、WebP の画像だけ使えます。',
      )
      expect(await pick(page).inputValue()).toBe('')
      await pick(page).setInputFiles(
        file(new Uint8Array(PICTURE_MAX_BYTES + 1), 'big.png', 'image/png'),
      )
      await expect
        .poll(() => notice.textContent(), SETTLE)
        .toContain('画像は 1 MB までです。')
      // A good file after a refused one clears the reason and goes.
      await pick(page).setInputFiles(file(png(20, 20), 'ok.png', 'image/png'))
      await expect.poll(() => page.url(), SETTLE).toContain('saved=picture')
      expect(uploads).toHaveLength(1)
    } finally {
      await context.close()
    }
  },
  45000,
)

test.skipIf(process.env.BROWSER === 'webkit')(
  'F28-AC87: Given a file was just chosen, When another is chosen before the page answers, Then only one upload is sent',
  async () => {
    const { page, context, uploads } = await settingsPage()
    try {
      const input = pick(page)
      await input.evaluate((el: HTMLInputElement) => {
        const make = (name: string) => {
          const data = new DataTransfer()
          data.items.add(
            new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
              type: 'image/png',
            }),
          )
          el.files = data.files
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }
        make('a.png')
        make('b.png')
      })
      await expect.poll(() => uploads.length, SETTLE).toBeGreaterThan(0)
      await page.waitForLoadState('load')
      expect(uploads).toHaveLength(1)
    } finally {
      await context.close()
    }
  },
  45000,
)

test.skipIf(process.env.BROWSER === 'webkit')(
  'F28-AC85: Given scripts do not run, When settings are opened, Then the upload button is there, and the file field is the pill button',
  async () => {
    const { page, context } = await settingsPage(false)
    try {
      await expect
        .poll(
          () =>
            page
              .getByRole('button', { name: '画像をアップロード' })
              .isVisible(),
          SETTLE,
        )
        .toBe(true)
      const pill = page.locator('label.picture-pick')
      expect(await pill.textContent()).toContain('画像を選ぶ')
      const box = await pill.boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(44)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(375)
    } finally {
      await context.close()
    }
  },
  30000,
)
