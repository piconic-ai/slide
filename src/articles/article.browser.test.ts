import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser, type Dialog } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
let browser: Browser
let cookie = ''
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  cookie = await signIn(env)
  await seedPublic(platform.env.DB, 'talk', 1, 'Talk')
  await drizzle(platform.env.DB)
    .update(deployments)
    .set({ description: 'About the talk.' })
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

/** The editing page, answered by the Worker, with the page's dialogs noted. */
async function openEditor() {
  const page = await browser.newPage()
  const dialogs: string[] = []
  page.on('dialog', async (dialog: Dialog) => {
    dialogs.push(dialog.type())
    await dialog.accept()
  })
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== TEST_ORIGIN) return route.abort()
    const { origin: _origin, ...headers } = await request.allHeaders()
    const post = request.method() === 'POST'
    const response = await server.fetch(
      new Request(url, {
        method: request.method(),
        headers: {
          ...headers,
          cookie,
          ...(post ? { origin: TEST_ORIGIN } : {}),
        },
        body: request.postData(),
        redirect: 'manual',
      }),
      env,
    )
    if (response.status >= 300 && response.status < 400)
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<p>redirected</p>',
      })
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}/slides/talk/article`)
  return { page, dialogs }
}

type EditorPage = Awaited<ReturnType<typeof openEditor>>['page']

/** Goes to another page; a dialog, if the page asks one, is noted by `openEditor`. */
const leave = async (page: EditorPage) => {
  await page.waitForFunction(() => 'slidePage' in window)
  await page.goto(`${TEST_ORIGIN}/help`)
}

/** Types as a person does: the browser asks about leaving only after a real key press. */
async function type(page: EditorPage, words: string) {
  await page.getByLabel('本文(Markdown)').click()
  await page.keyboard.type(words)
}

test('F26-AC30: Given the editing page with nothing typed, When the author leaves, Then no question is asked', async () => {
  const { page, dialogs } = await openEditor()
  await leave(page)
  expect(dialogs).toEqual([])
})

test('F26-AC30: Given text typed and not saved, When the author leaves the page, Then the browser asks before it goes', async () => {
  const { page, dialogs } = await openEditor()
  await type(page, 'draft in progress')
  await leave(page)
  expect(dialogs).toEqual(['beforeunload'])
})

test('F26-AC37, F26-AC30: Given text typed and then previewed, When the author goes back to editing, Then the box holds the text, and leaving still asks, as it is not saved', async () => {
  const { page, dialogs } = await openEditor()
  await type(page, 'draft in progress')
  await page.getByRole('button', { name: 'プレビュー' }).click()
  await page.getByRole('button', { name: '編集に戻る' }).click()
  await expect
    .poll(() => page.getByLabel('本文(Markdown)').inputValue())
    .toBe('draft in progress')
  await leave(page)
  expect(dialogs).toEqual(['beforeunload'])
})

/** Opens the preview of the text with the window as wide as asked. */
async function openPreview(width: number) {
  const { page } = await openEditor()
  await page.setViewportSize({ width, height: 900 })
  await type(page, 'Paragraph of the article.')
  await page.getByRole('button', { name: 'プレビュー' }).click()
  await page.locator('[data-article-preview]').waitFor()
  return page
}

test('F26-AC33, F26-AC36, F26-AC42: Given a wide window, When the author previews, Then the page is the viewer: the slides span the width, the article is on the left and the side column on the right, with the band above', async () => {
  const page = await openPreview(1280)
  const box = async (selector: string) =>
    (await page.locator(selector).first().boundingBox())!
  const stage = await box('.viewer-layout > .stage')
  const article = await box('.viewer-article')
  const side = await box('[data-viewer-side]')
  expect(stage.width).toBeGreaterThan(article.width)
  expect(side.x).toBeGreaterThan(article.x + article.width - 1)
  expect(side.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1)
  expect((await box('[data-article-preview]')).y).toBeLessThan(stage.y)
  const back = await page
    .getByRole('button', { name: '編集に戻る' })
    .boundingBox()
  expect(back!.height).toBeGreaterThanOrEqual(44)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.close()
})

test('F26-AC42: Given a narrow window, When the author previews, Then the parts stand in one column and nothing runs off the side', async () => {
  const page = await openPreview(375)
  const box = async (selector: string) =>
    (await page.locator(selector).first().boundingBox())!
  const article = await box('.viewer-article')
  const side = await box('.viewer-description')
  expect(Math.abs(side.x - article.x)).toBeLessThan(2)
  // One column: the description stands above the article, not beside it.
  expect(side.y).toBeLessThan(article.y)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.close()
})

test('F26-AC30: Given text typed, When the author presses save, Then the browser does not ask on the way out', async () => {
  const { page, dialogs } = await openEditor()
  await type(page, 'to be saved')
  await page.getByRole('button', { name: '下書きを保存' }).click()
  await page.getByText('redirected').waitFor()
  expect(dialogs).toEqual([])
})

test('F26-AC43, F26-AC44, F26-AC46: Given the editing page, When it opens, Then there is no tab, the box is always there, preview stands beside the save and publish buttons, and one small link goes to the help', async () => {
  const { page } = await openEditor()
  expect(await page.getByRole('tab').count()).toBe(0)
  expect(await page.getByRole('tablist').count()).toBe(0)
  await page.getByLabel('本文(Markdown)').waitFor()
  const names = ['プレビュー', '下書きを保存', '公開する']
  const boxes = []
  for (const name of names)
    boxes.push((await page.getByRole('button', { name }).boundingBox())!)
  // One row, in this order, each at least 44px tall.
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x)
  expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x)
  for (const box of boxes) {
    expect(Math.abs(box.y - boxes[0]!.y)).toBeLessThan(2)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  const links = page.getByRole('link', { name: '書き方' })
  expect(await links.count()).toBe(1)
  expect(await links.getAttribute('href')).toBe('/help#article')
  expect((await links.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.close()
})

test('F26-AC45: Given the editing page, When it opens, Then none of the long explanations is on it', async () => {
  const { page } = await openEditor()
  const body = await page.locator('main').innerText()
  for (const gone of [
    'ページ番号つきの共有 URL',
    'HTML と script は使えません',
    'AI エージェントは下書きまで',
    '一般公開中の間だけ',
  ])
    expect(body).not.toContain(gone)
  await page.close()
})

test('F26-AC47: Given a wide and a narrow window, When the editing page opens, Then the box is wide and tall enough on the wide one, monospace, and nothing runs off the side on the narrow one', async () => {
  const { page } = await openEditor()
  await page.setViewportSize({ width: 1280, height: 900 })
  const box = (await page.getByLabel('本文(Markdown)').boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(960)
  expect(box.width).toBeLessThanOrEqual(1120)
  const lines = await page
    .getByLabel('本文(Markdown)')
    .evaluate(
      (area) =>
        area.clientHeight / parseFloat(getComputedStyle(area).lineHeight),
    )
  expect(lines).toBeGreaterThanOrEqual(24)
  expect(
    await page
      .getByLabel('本文(Markdown)')
      .evaluate((area) => getComputedStyle(area).fontFamily),
  ).toMatch(/mono|Menlo|Consolas|monospace/i)
  await page.setViewportSize({ width: 375, height: 800 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.close()
})
