import { openTestBrowser } from '../test-open-browser'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import type { Browser } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { testEnv } from '../publication/test-support'
import { ACCESS_TOKEN_HEADER } from './access'
import { accessTeam, AUDIENCE, OPERATOR_ORIGIN, TEAM } from './test-support'

const team = await accessTeam()
vi.mock('./access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
} as unknown as Env

let browser: Browser
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  browser = await openTestBrowser()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

/** The operator host in a real browser, its requests answered by the Worker, with the token Cloudflare Access would attach. */
async function open(width: number) {
  const page = await browser.newPage({ viewport: { width, height: 800 } })
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== OPERATOR_ORIGIN) return route.abort()
    const response = await server.fetch(
      new Request(url, {
        headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
      }),
      env,
    )
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  return page
}

test.each([
  ['/', '運営'],
  ['/metrics', '計測'],
  ['/operations', '運用'],
])(
  'Given the operator page %s, When it is opened at 1280 and 375 px wide, Then it does not scroll sideways and its links are 44px tall',
  async (path, heading) => {
    for (const width of [1280, 375]) {
      const page = await open(width)
      await page.goto(`${OPERATOR_ORIGIN}${path}`)
      await page.getByRole('heading', { level: 1, name: heading }).waitFor()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(overflow, `${path} at ${width}`).toBeLessThanOrEqual(0)
      const nav = page.getByRole('navigation', { name: '運営の画面' })
      for (const link of await nav.getByRole('link').all())
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await page.close()
    }
  },
  30000,
)

test('Given the operations page, When it is opened, Then the five frames are headings in the page in order', async () => {
  const page = await open(1280)
  await page.goto(`${OPERATOR_ORIGIN}/operations`)
  const headings = await page
    .getByRole('heading', { level: 2 })
    .allTextContents()
  expect(headings).toEqual([
    'メンテナンスの予定',
    '新しい登録',
    'メールアドレスの暗号化',
    'バックアップ',
    '通知',
  ])
  await page.close()
}, 30000)
