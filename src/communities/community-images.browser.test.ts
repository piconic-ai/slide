import { drizzle } from 'drizzle-orm/d1'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { communities } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { png } from '../profile/test-picture'
import { cleanPng } from '../profile/picture-png'
import {
  OWNER_ID,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { IMAGE_RULES, imageKey } from './image-policy'
import { resetCommunities, seedCommunity } from './test-communities'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const bucket = platform.env.UPLOADS
const env = testEnv(platform.env)
const ID = 12

let browser: Browser
let cookie = ''
beforeAll(async () => {
  await applyMigrations(db)
  browser = await chromium.launch()
})
beforeEach(async () => {
  await resetCommunities(db)
  await bucket.delete([imageKey(ID, 'logo'), imageKey(ID, 'cover')])
  cookie = await signIn(env)
  await seedCommunity(db, {
    id: ID,
    handle: 'kanagawapm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

async function openEdit(): Promise<Page> {
  const page = await browser.newPage({ locale: 'ja-JP' })
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    // As the service's own page sends it; the interception drops the origin.
    const headers: Record<string, string> = {
      ...(await request.allHeaders()),
      cookie,
    }
    if (request.method() === 'POST') headers.origin = TEST_ORIGIN
    const body = request.postDataBuffer()
    const response = await server.fetch(
      new Request(url, {
        method: request.method(),
        headers,
        body:
          body && request.method() !== 'GET' ? new Uint8Array(body) : undefined,
      }),
      env,
    )
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}/@kanagawapm/edit`)
  await page.waitForLoadState('networkidle')
  return page
}

const pick = (page: Page, image: 'logo' | 'cover') =>
  page.locator(`input[form="community-${image}-form"]`)
const stored = async () => drizzle(db).select().from(communities).get()

test.each([
  [3200, 600, 1600, 400],
  [400, 300, 400, 100],
])(
  'F30-AC30: Given a %ix%i picture chosen as the cover, When the page sends it, Then a 4:1 PNG %ix%i is kept, never drawn larger',
  async (width, height, keptWidth, keptHeight) => {
    const page = await openEdit()
    await pick(page, 'cover').setInputFiles({
      name: 'cover.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png(width, height)),
    })
    // The redirect after the post is not followed here; the row tells.
    await expect
      .poll(async () => (await stored())?.cover_at ?? null)
      .not.toBeNull()
    const object = await bucket.get(imageKey(ID, 'cover'))
    const bytes = new Uint8Array(await object!.arrayBuffer())
    const view = new DataView(bytes.buffer, bytes.byteOffset + 16, 8)
    expect([view.getUint32(0), view.getUint32(4)]).toEqual([
      keptWidth,
      keptHeight,
    ])
    expect(cleanPng(bytes, IMAGE_RULES.cover.png).kind).toBe('ok')
    await page.close()
  },
  20000,
)

test('F30-AC30: Given a picture chosen as the logo, When the page sends it, Then a 256 square PNG is kept and shown', async () => {
  const page = await openEdit()
  await pick(page, 'logo').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png(300, 120)),
  })
  await expect
    .poll(async () => (await stored())?.logo_at ?? null)
    .not.toBeNull()
  const object = await bucket.get(imageKey(ID, 'logo'))
  const bytes = new Uint8Array(await object!.arrayBuffer())
  expect(cleanPng(bytes, IMAGE_RULES.logo.png).kind).toBe('ok')
  await page.close()
}, 20000)

test.each([
  [
    'text named .png that says it is a PNG',
    'logo',
    'fake.png',
    'image/png',
    Buffer.from('<svg onload="alert(1)"></svg>'),
    'PNG、JPEG、WebP の画像だけ使えます。',
  ],
  [
    'a cover over 2 MB',
    'cover',
    'big.png',
    'image/png',
    Buffer.concat([Buffer.from(png(4, 1)), Buffer.alloc(2 * 1024 * 1024)]),
    '画像は 2 MB までです。',
  ],
  [
    'a logo over 1 MB',
    'logo',
    'big.png',
    'image/png',
    Buffer.concat([Buffer.from(png(4, 4)), Buffer.alloc(1024 * 1024)]),
    '画像は 1 MB までです。',
  ],
] as const)(
  'F30-AC29: Given %s, When it is chosen, Then the reason shows under the field and nothing is sent',
  async (_name, image, file, mimeType, buffer, reason) => {
    const page = await openEdit()
    await pick(page, image).setInputFiles({ name: file, mimeType, buffer })
    await expect
      .poll(() => page.locator(`#community-${image}-error`).textContent())
      .toBe(reason)
    expect(page.url()).toBe(`${TEST_ORIGIN}/@kanagawapm/edit`)
    expect(await stored()).toMatchObject({ logo_at: null, cover_at: null })
    await page.close()
  },
  20000,
)

test('F30-AC32: Given the deletion at the bottom of the editing page, When the handle is typed, Then "delete" is enabled only once it matches', async () => {
  const page = await openEdit()
  const button = page.getByRole('button', { name: '削除する' })
  const field = page.getByLabel(
    '確認のため、このコミュニティのハンドル kanagawapm を入力してください',
  )
  expect(await button.isDisabled()).toBe(true)
  await field.fill('kanagawa')
  expect(await button.isDisabled()).toBe(true)
  await field.fill('kanagawapm')
  expect(await button.isEnabled()).toBe(true)
  await field.fill('kanagawapm2')
  expect(await button.isDisabled()).toBe(true)
  await page.close()
}, 20000)

test('F30-AC45: Given the color swatches, When an arrow key moves from red and the form is saved, Then the next color is kept and each swatch is at least 44px to press', async () => {
  const page = await openEdit()
  const red = page.getByRole('radio', { name: '赤' })
  expect(await red.isChecked()).toBe(true)
  for (const name of ['赤', '橙', '黄', '緑', '紺']) {
    const box = await page.getByRole('radio', { name }).boundingBox()
    expect(box?.width, name).toBeGreaterThanOrEqual(44)
    expect(box?.height, name).toBeGreaterThanOrEqual(44)
  }
  await red.focus()
  await page.keyboard.press('ArrowRight')
  expect(await page.getByRole('radio', { name: '橙' }).isChecked()).toBe(true)
  await page.getByRole('button', { name: '保存する' }).last().click()
  await expect.poll(async () => (await stored())?.color).toBe('orange')
  await page.close()
}, 20000)
