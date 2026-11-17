import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import { readTakedown } from '../publication/takedown-store'
import {
  resetTables,
  seedPublic,
  signIn,
  testEnv,
} from '../publication/test-support'
import { ACCESS_TOKEN_HEADER } from './access'
import { accessTeam, AUDIENCE, OPERATOR_ORIGIN, TEAM } from './test-support'

const team = await accessTeam()
vi.mock('./access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
} as unknown as Env

let browser: Browser
beforeAll(async () => {
  await applyMigrations(db)
  browser = await chromium.launch()
})
beforeEach(async () => {
  await resetTables(db)
  await signIn(env)
  await seedPublic(db, 'talk', 100, 'Talk')
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

// Other browser tests run at the same time.
const SETTLE = { timeout: 10000 }

/**
 * The operator page in a real browser, its requests answered by the Worker.
 * Cloudflare Access is stood in for by adding the token it would attach;
 * every other header, the Origin of a form post among them, is the
 * browser's own. A redirect is answered by the page it leads to, because
 * the browser would fetch that page without asking the route.
 */
async function open() {
  const posts: { origin: string | undefined; status: number }[] = []
  const page = await browser.newPage()
  const answer = async (url: URL, init: RequestInit) =>
    server.fetch(new Request(url, { ...init, redirect: 'manual' }), env)
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== OPERATOR_ORIGIN) return route.abort()
    const headers: Record<string, string> = {
      ...(await request.allHeaders()),
      [ACCESS_TOKEN_HEADER]: await team.sign(),
    }
    let response = await answer(url, {
      method: request.method(),
      headers,
      body: request.postData(),
    })
    if (request.method() === 'POST')
      posts.push({ origin: headers.origin, status: response.status })
    const location = response.headers.get('Location')
    if (response.status === 303 && location)
      response = await answer(new URL(location, OPERATOR_ORIGIN), {
        headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
      })
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${OPERATOR_ORIGIN}/`)
  return { page, posts }
}

test('F17-AC14: Given the operator page in a browser, When the hide form is submitted and then the release button is pressed, Then the browser sends its own origin, both are accepted, and the deck is hidden and released', async () => {
  const { page, posts } = await open()

  await page.fill('#target', '@owner/talk')
  await page.fill('#reason', 'fake sign-in page')
  await page.click('form[action="/takedowns"] button')
  await expect
    .poll(() => page.textContent('[role="status"]'), SETTLE)
    .toBe('非表示にしました。')
  expect(posts).toEqual([{ origin: OPERATOR_ORIGIN, status: 303 }])
  expect(await readTakedown(db, 'talk')).toMatchObject({
    reason: 'fake sign-in page',
    operator: 'op@example.com',
  })
  // The page also lists reported decks; the hidden ones have the operator column.
  expect(
    await page.locator('table', { hasText: '操作者' }).textContent(),
  ).toContain('@owner/talk')

  await page.click('form[action="/takedowns/talk/release"] button')
  await expect
    .poll(() => page.textContent('[role="status"]'), SETTLE)
    .toBe('非表示を解除しました。')
  expect(posts.at(-1)).toEqual({ origin: OPERATOR_ORIGIN, status: 303 })
  expect(await readTakedown(db, 'talk')).toBeNull()
  await page.close()
}, 30000)
