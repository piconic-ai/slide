import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import {
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from './test-communities'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

const LONG = 'Supercalifragilisticexpialidocious_community_name_without_a_break'
let browser: Browser
let cookie = ''
beforeAll(async () => {
  await applyMigrations(db)
  await resetCommunities(db)
  cookie = await signIn(env)
  await seedCommunity(db, {
    id: 3,
    handle: 'kanagawapm',
    name: LONG.slice(0, 50),
    links: [
      'https://kanagawapm.connpass.com/',
      'https://a-very-long-host-name-for-the-community.example/',
    ],
  })
  // Event 1 has six talks, more than a row holds; event 2 has one.
  for (let i = 0; i < 6; i++) {
    await seedPublic(db, `many-${i}`, 100 + i, `${LONG} ${i}`)
    await seedTalkLink(db, {
      deckId: `many-${i}`,
      url: 'https://kanagawapm.connpass.com/event/1/',
      title: 'Many',
    })
  }
  await seedPublic(db, 'single', 50, 'Single')
  await seedTalkLink(db, {
    deckId: 'single',
    url: 'https://kanagawapm.connpass.com/event/2/',
    title: 'Single',
  })
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

async function open(path: string, width: number): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    locale: 'ja-JP',
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    const { origin: _origin, ...headers } = await route.request().allHeaders()
    headers.cookie = cookie
    const response = await server.fetch(new Request(url, { headers }), env)
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}${path}`)
  await page.waitForLoadState('networkidle')
  return page
}

const overflow = (): number =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth

const buttonsOf = (page: Page, name: string) =>
  page
    .locator('.community-event', {
      has: page.getByRole('link', { name, exact: true }),
    })
    .locator('.carousel-buttons')

test.each([1280, 375])(
  'F30-AC41, F30-AC42: Given the community page and the page that makes one, When they settle at %ipx, Then nothing runs past the screen, and the link to the help is tall enough to press',
  async (width) => {
    for (const path of [
      '/@kanagawapm',
      '/@kanagawapm/slides',
      '/communities/new',
    ]) {
      const page = await open(path, width)
      expect(await page.evaluate(overflow), path).toBe(0)
      if (path === '/communities/new') {
        const box = await page
          .getByRole('link', { name: 'コミュニティについてくわしく(ヘルプ)' })
          .boundingBox()
        expect(box?.height).toBeGreaterThanOrEqual(44)
      }
      await page.close()
    }
  },
  30000,
)

test('F30-AC20: Given a row wider than its frame and one that fits, When the page settles at 1280px, Then only the wide one shows the buttons, and they send it', async () => {
  const page = await open('/@kanagawapm', 1280)
  await expect.poll(() => buttonsOf(page, 'Many').isVisible()).toBe(true)
  expect(await buttonsOf(page, 'Single').isVisible()).toBe(false)
  const region = page.getByRole('region', { name: 'Many のスライド' })
  expect(await region.evaluate((el) => el.scrollLeft)).toBe(0)
  await buttonsOf(page, 'Many')
    .getByRole('button', { name: '次のスライド' })
    .click()
  await expect
    .poll(() => region.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0)
  await page.close()
})

test('F30-AC20: Given the row of slides, When it is focused and the right arrow is pressed, Then it moves sideways', async () => {
  const page = await open('/@kanagawapm', 375)
  const region = page.getByRole('region', { name: 'Many のスライド' })
  await region.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(() => region.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0)
  expect(await page.evaluate(overflow)).toBe(0)
  await page.close()
})

test.each([
  [1280, 16],
  [375, 8],
])(
  'F30-AC23: Given a community with the default cover at %ipx, When it settles, Then two rows of %i whole squares show',
  async (width, across) => {
    const page = await open('/@kanagawapm', width)
    const cover = page.getByRole('img', {
      name: `${LONG.slice(0, 50)} のカバー画像`,
    })
    expect(await cover.count()).toBe(1)
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('.cover-pattern > span')]
        .filter((element) => element.checkVisibility())
        .map((element) => element.getBoundingClientRect())
        .map((box) => ({
          top: Math.round(box.top),
          right: box.right,
          w: box.width,
          h: box.height,
        })),
    )
    expect(boxes).toHaveLength(across * 2)
    expect(new Set(boxes.map((box) => box.top)).size).toBe(2)
    for (const box of boxes) {
      expect(Math.abs(box.w - box.h)).toBeLessThan(1)
      expect(box.right).toBeLessThanOrEqual(width)
    }
    await page.close()
  },
  20000,
)
