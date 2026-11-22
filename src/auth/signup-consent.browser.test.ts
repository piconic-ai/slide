import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import { openPage } from '../drops/test-browser'
import { authSession, authUser } from '../db/auth-schema'
import { invitedEmails } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { resetTables, signIn, testEnv } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
const orm = drizzle(platform.env.DB)
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

/** The welcome page of someone who signed in and has no account yet. */
async function welcome(width: number) {
  const cookie = await signIn(env, 'newbie', { welcomed: false })
  const { page } = await openPage(browser, env, '/welcome', { cookie })
  await page.setViewportSize({ width, height: 800 })
  await page.locator('[data-start]').waitFor(SETTLE)
  return page
}

test('F28-AC59: Given the welcome page, When the agreement box is not ticked, Then "Get started" is disabled, and it is enabled while the box is ticked', async () => {
  for (const width of [1280, 375]) {
    const page = await welcome(width)
    const start = page.locator('[data-start]')
    const box = page.locator('[data-terms]')
    await expect.poll(() => start.isDisabled(), SETTLE).toBe(true)
    await box.check()
    await expect.poll(() => start.isEnabled(), SETTLE).toBe(true)
    await box.uncheck()
    await expect.poll(() => start.isDisabled(), SETTLE).toBe(true)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.context().close()
  }
})

test('F28-AC63: Given the welcome page, When "Leave without signing up" is pressed, Then the records are gone and the top page opens', async () => {
  const page = await welcome(1280)
  expect(await orm.$count(authUser)).toBe(1)
  await page.getByRole('button', { name: '登録せずに終了する' }).click()
  await page.waitForURL(/\/$/, SETTLE)
  expect(await orm.$count(authUser)).toBe(0)
  expect(await orm.$count(authSession)).toBe(0)
  // The operator's invitation is not part of what the person made.
  expect(await orm.$count(invitedEmails)).toBe(1)
  await page.context().close()
})
