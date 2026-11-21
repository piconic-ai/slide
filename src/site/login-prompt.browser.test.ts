import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { drizzle } from 'drizzle-orm/d1'
import { follows } from '../db/schema'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = {
  ...withInvited(testEnv(platform.env)),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
let browser: Browser
let alice = ''
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  alice = await signIn(env, 'alice')
  await signIn(env, 'bob', { id: INVITED_ID })
  await seedPublic(platform.env.DB, 'talk', 2, 'Bob’s talk', INVITED_ID)
  await seedPublic(platform.env.DB, 'keynote', 1, 'Alice’s keynote', OWNER_ID)
  await drizzle(platform.env.DB)
    .insert(follows)
    .values({
      follower_user_id: OWNER_ID,
      followee_user_id: INVITED_ID,
      created_at: 1,
    })
    .onConflictDoNothing()
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

const SETTLE = { timeout: 10000 }
const DIALOG = '.login-prompt[role="dialog"]'

/** A page of the service answered by the Worker; the writes it sends are kept. */
async function open(path: string, cookie = '') {
  const page = await browser.newPage()
  const writes: string[] = []
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    if (request.method() !== 'GET')
      writes.push(`${request.method()} ${url.pathname}`)
    const { origin: _origin, ...headers } = await request.allHeaders()
    if (cookie) headers.cookie = cookie
    const response = await server.fetch(
      new Request(url, {
        method: request.method(),
        headers,
        body: request.postData(),
        redirect: 'manual',
      }),
      env,
    )
    if (response.status >= 300 && response.status < 400)
      return route.fulfill({ status: 200, contentType: 'text/html', body: '' })
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}${path}`)
  return { page, writes }
}

const focused = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement?.getAttribute('data-login-prompt') ??
      document.activeElement?.textContent?.trim(),
  )

test('F21-AC46: Given a visitor on Bob’s profile, When they press Follow, Then a modal dialog opens with its title, focus inside, the page behind it still, and nothing is sent', async () => {
  const { page, writes } = await open('/@bob')
  await page.getByRole('link', { name: 'フォロー', exact: true }).click()
  const dialog = page.locator(DIALOG)
  await expect.poll(() => dialog.count(), SETTLE).toBe(1)
  expect(await dialog.getAttribute('aria-modal')).toBe('true')
  const titleId = await dialog.getAttribute('aria-labelledby')
  expect(await page.locator(`#${titleId}`).textContent()).toBe(
    'フォローするには、ログインしてください',
  )
  expect(await focused(page)).toBe('ログインして続ける')
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
  expect(
    await page.locator('main').evaluate((main) => (main as HTMLElement).inert),
  ).toBe(true)
  expect(writes).toEqual([])
  await page.close()
})

test('F21-AC47: Given the modal is open, When Tab and Shift+Tab are pressed past its ends, Then focus goes round inside it', async () => {
  const { page } = await open('/@bob')
  await page.getByRole('link', { name: 'フォロー', exact: true }).click()
  await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(1)
  await page.keyboard.press('Tab')
  expect(await focused(page)).toBe('閉じる')
  await page.keyboard.press('Tab')
  expect(await focused(page)).toBe('ログインして続ける')
  await page.keyboard.press('Shift+Tab')
  expect(await focused(page)).toBe('閉じる')
  await page.close()
})

test.each(['Escape', 'close'])(
  'F21-AC47: Given the modal is open, When it is closed by %s, Then it goes, focus returns to Follow, and the page scrolls again',
  async (how) => {
    const { page } = await open('/@bob')
    const follow = page.getByRole('link', { name: 'フォロー', exact: true })
    await follow.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(1)
    if (how === 'Escape') await page.keyboard.press('Escape')
    else await page.getByRole('button', { name: '閉じる' }).click()
    await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(0)
    expect(await focused(page)).toBe('follow')
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
    expect(
      await page
        .locator('main')
        .evaluate((main) => (main as HTMLElement).inert),
    ).toBe(false)
    await page.close()
  },
)

test('F21-AC48: Given the modal is open on Bob’s followers list, When its sign-in link is read, Then it goes to GitHub and back to that list', async () => {
  const { page } = await open('/@bob/followers')
  await page.getByRole('link', { name: '@alice さんをフォローする' }).click()
  await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(1)
  expect(
    await page
      .getByRole('link', { name: 'ログインして続ける' })
      .getAttribute('href'),
  ).toBe('/auth/github?to=%2F%40bob%2Ffollowers')
  await page.close()
})

test('F21-AC49: Given an English visitor, When they press Follow, Then the modal speaks English', async () => {
  const { page } = await open('/@bob?lang=en')
  await page.getByRole('link', { name: 'Follow', exact: true }).click()
  await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(1)
  expect(await page.locator(`${DIALOG} h2`).textContent()).toBe(
    'Sign in to follow',
  )
  expect(await focused(page)).toBe('Sign in to continue')
  await page.getByRole('button', { name: 'Close' }).click()
  await page.close()
})

test('F03-AC91: Given a visitor on Bob’s slides, When they press Report in the menu, Then the report modal opens, and closing it puts focus on the menu’s button', async () => {
  const { page, writes } = await open('/@bob/talk')
  await page.locator('summary[aria-label="そのほかの操作"]').click()
  await page.getByRole('link', { name: '通報する' }).click()
  await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(1)
  expect(await page.locator(`${DIALOG} h2`).textContent()).toBe(
    '通報するには、ログインしてください',
  )
  await page.keyboard.press('Escape')
  await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(0)
  expect(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label'),
    ),
  ).toBe('そのほかの操作')
  expect(writes).toEqual([])
  await page.close()
})

test('F03-AC90: Given a visitor on Bob’s slides, When they press Mute this author, Then the mute modal opens and nothing is sent', async () => {
  const { page, writes } = await open('/@bob/talk')
  await page.locator('summary[aria-label="そのほかの操作"]').click()
  await page.getByRole('link', { name: 'この作者をミュート' }).click()
  await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(1)
  expect(await page.locator(`${DIALOG} h2`).textContent()).toBe(
    'ミュートするには、ログインしてください',
  )
  expect(writes).toEqual([])
  await page.close()
})

test('F21-AC45: Given a signed-in reader, When Bob’s profile opens and the follow button is pressed, Then no modal opens and the form is sent', async () => {
  const { page, writes } = await open('/@bob', alice)
  // Alice already follows Bob, so the button releases the follow.
  await page.locator('.follow-form button').click()
  await expect.poll(() => writes.length, SETTLE).toBeGreaterThan(0)
  expect(await page.locator(DIALOG).count()).toBe(0)
  expect(writes[0]).toBe('POST /follows/bob/release')
  await page.close()
})

test('F21-AC48: Given the slides were turned to page 5 before the modal opens, When its sign-in link is read, Then it returns to page 5, not the page first loaded', async () => {
  const { page } = await open('/@bob/talk')
  // What /share.js does to the links when the slides say which page shows.
  await page.evaluate(() => {
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      'a[data-slide-return]',
    ))
      link.href = link.href.replace(/slide=[^&]*/, 'slide=%2F%40bob%2Ftalk%2F5')
  })
  await page.locator('a[data-login-prompt="follow"]').click()
  await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(1)
  expect(
    await page
      .getByRole('link', { name: 'ログインして続ける' })
      .getAttribute('href'),
  ).toBe('/auth/github?to=%2F%40bob%2Ftalk%2F5')
  await page.close()
})

test('F21-AC47: Given the modal is open, When a press starts on the panel and ends on the backdrop, Then it stays open, and a press on the backdrop alone closes it', async () => {
  const { page } = await open('/@bob')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('link', { name: 'フォロー', exact: true }).click()
  await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(1)
  const panel = await page.locator('.login-prompt-panel').boundingBox()
  if (!panel) throw new Error('no panel')
  await page.mouse.move(panel.x + 20, panel.y + 20)
  await page.mouse.down()
  await page.mouse.move(5, 5)
  await page.mouse.up()
  expect(await page.locator(DIALOG).count()).toBe(1)
  await page.mouse.click(5, 5)
  await expect.poll(() => page.locator(DIALOG).count(), SETTLE).toBe(0)
  await page.close()
})
