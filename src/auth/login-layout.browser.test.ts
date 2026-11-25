import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../db/test-migrations'
import { resetTables, testEnv } from '../publication/test-support'
import { openPage } from '../drops/test-browser'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
let browser: Browser

vi.setConfig({ testTimeout: 120000, hookTimeout: 60000 })
const SETTLE = { timeout: 60000 }

beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  browser = await chromium.launch()
})
beforeEach(() => resetTables(platform.env.DB))
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

/** Submits a malformed address, which the service answers with a notice. */
async function refusedLogin(width: number) {
  const { page } = await openPage(browser, env, '/login')
  await page.setViewportSize({ width, height: 800 })
  await page.locator('input[type="email"]').fill('aa')
  await page.evaluate(() => {
    document.querySelector('form')?.setAttribute('novalidate', '')
  })
  await page.locator('button[type="submit"]').click()
  await expect
    .poll(() => page.locator('[role="alert"]').count(), SETTLE)
    .toBe(1)
  return page
}

test('F28-AC55: Given a refused address on the login page, When the notice appears, Then it is as wide as the field under it and the same distance from the text above as from the form below', async () => {
  for (const width of [1280, 375]) {
    const page = await refusedLogin(width)
    const box = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((element) => {
          const { left, right, top, bottom } = element.getBoundingClientRect()
          return { left, right, top, bottom }
        })
    const [notice, field, intro, label] = await Promise.all([
      box('[role="alert"]'),
      box('input[type="email"]'),
      box('.login-page > .field-note'),
      box('label'),
    ])
    expect(notice.left).toBeCloseTo(field.left, 0)
    expect(notice.right).toBeCloseTo(field.right, 0)
    // Two gaps that differ by a few pixels read as a crooked layout.
    expect(Math.abs(notice.top - intro.bottom - 16)).toBeLessThanOrEqual(1)
    expect(Math.abs(label.top - notice.bottom - 20)).toBeLessThanOrEqual(1)
    await page.context().close()
  }
})
