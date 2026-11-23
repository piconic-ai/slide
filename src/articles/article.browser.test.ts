import { drizzle } from 'drizzle-orm/d1'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from 'vitest'
import { chromium, type Browser, type Dialog, type Page } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { articleCitations, articles, deployments } from '../db/schema'
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
/** Every page a test opened, closed after it so none keeps saving into the next. */
const opened: Page[] = []
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  cookie = await signIn(env)
  await seedPublic(platform.env.DB, 'talk', 1, 'Talk')
  await drizzle(platform.env.DB)
    .update(deployments)
    .set({ description: 'About the talk.' })
  browser = await chromium.launch()
})
afterEach(async () => {
  await Promise.all(
    opened.splice(0).map((page) => page.close().catch(() => {})),
  )
})
beforeEach(async () => {
  const orm = drizzle(platform.env.DB)
  await orm.delete(articleCitations)
  await orm.delete(articles)
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

/** The editing page, answered by the Worker, with the page's dialogs noted. */
async function openEditor(as = cookie, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  opened.push(page)
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
          cookie: as,
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
  await page.waitForFunction(() => 'slidePage' in window)
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

const box = (page: EditorPage) => page.getByLabel('本文(Markdown)')
const status = (page: EditorPage) => page.locator('[data-autosave-status]')
const stored = async () =>
  (await drizzle(platform.env.DB).select().from(articles))[0]

test('F26-AC51: Given the editing page with nothing typed, When the author leaves, Then no question is asked', async () => {
  const { page, dialogs } = await openEditor()
  await leave(page)
  expect(dialogs).toEqual([])
})

test('F26-AC49, F26-AC50, F26-AC51: Given text typed, When the author waits, Then it is saved by itself, the state is shown, and leaving afterwards asks nothing, while leaving at once asks', async () => {
  const quick = await openEditor()
  await type(quick.page, 'draft in progress')
  await leave(quick.page)
  expect(quick.dialogs).toEqual(['beforeunload'])

  const { page, dialogs } = await openEditor()
  await type(page, 'kept by itself')
  await expect
    .poll(() => status(page).innerText(), { timeout: 10_000 })
    .toContain('保存しました')
  expect((await stored())?.body).toContain('kept by itself')
  await leave(page)
  expect(dialogs).toEqual([])
})

test('F26-AC50: Given the server refuses the save, When text is typed, Then the state says it could not save, the text stays, and leaving still asks', async () => {
  const { page, dialogs } = await openEditor()
  await page.route('**/article/autosave', (route) => route.abort())
  await type(page, 'not saved')
  await expect
    .poll(() => status(page).innerText(), { timeout: 10_000 })
    .toContain('保存できませんでした')
  expect(await box(page).inputValue()).toBe('not saved')
  await leave(page)
  expect(dialogs).toEqual(['beforeunload'])
})

test('F26-AC37, F26-AC51: Given text typed and then previewed, When the author goes back to editing, Then the box holds the text, it was kept on the way, and leaving asks nothing', async () => {
  const { page, dialogs } = await openEditor()
  await type(page, 'draft in progress')
  await page.getByRole('button', { name: 'プレビュー' }).click()
  await page.getByRole('button', { name: '編集に戻る' }).click()
  await expect.poll(() => box(page).inputValue()).toBe('draft in progress')
  // Pressing preview kept what was typed first, so nothing is left to save.
  expect((await stored())?.body).toBe('draft in progress')
  await leave(page)
  expect(dialogs).toEqual([])
})

/** Opens the preview of the text with the window as wide as asked. */
async function openPreview(width: number) {
  const { page } = await openEditor(cookie, width)
  await type(page, 'Paragraph of the article.')
  await page.getByRole('button', { name: 'プレビュー' }).click()
  await page.locator('[data-article-preview]').waitFor()
  return page
}

test('F26-AC33, F26-AC36, F26-AC42: Given a wide window, When the author previews, Then the page is the viewer with the band above', async () => {
  const page = await openPreview(1280)
  const at = async (selector: string) =>
    (await page.locator(selector).first().boundingBox())!
  const stage = await at('.viewer-layout > .stage')
  const article = await at('.viewer-article')
  const side = await at('[data-viewer-side]')
  expect(stage.width).toBeGreaterThan(article.width)
  expect(side.x).toBeGreaterThan(article.x + article.width - 1)
  expect((await at('[data-article-preview]')).y).toBeLessThan(stage.y)
  const back = await page
    .getByRole('button', { name: '編集に戻る' })
    .boundingBox()
  expect(back!.height).toBeGreaterThanOrEqual(44)
  await page.close()
})

test('F26-AC42: Given a narrow window, When the author previews, Then the parts stand in one column and nothing runs off the side', async () => {
  const page = await openPreview(375)
  const at = async (selector: string) =>
    (await page.locator(selector).first().boundingBox())!
  const article = await at('.viewer-article')
  const description = await at('.viewer-description')
  expect(Math.abs(description.x - article.x)).toBeLessThan(2)
  expect(description.y).toBeLessThan(article.y)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.close()
})

test('F26-AC43, F26-AC63, F26-AC46: Given a draft, When the editing page opens, Then there is no tab, the buttons are preview and publish in one row, each 44px tall, and one link goes to the help', async () => {
  const { page } = await openEditor()
  expect(await page.getByRole('tab').count()).toBe(0)
  const names = ['プレビュー', '公開する']
  const boxes = []
  for (const name of names)
    boxes.push((await page.getByRole('button', { name }).boundingBox())!)
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x)
  for (const one of boxes) {
    expect(Math.abs(one.y - boxes[0]!.y)).toBeLessThan(2)
    expect(one.height).toBeGreaterThanOrEqual(44)
  }
  expect(await page.getByRole('button', { name: '公開を更新' }).count()).toBe(0)
  const links = page.getByRole('link', { name: '書き方' })
  expect(await links.count()).toBe(1)
  expect(await links.getAttribute('href')).toBe('/help#article')
  expect((await links.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.close()
})

test('F26-AC45: Given the editing page, When it opens, Then none of the long explanations is on it', async () => {
  const { page } = await openEditor()
  const text = await page.locator('main').innerText()
  for (const gone of [
    'ページ番号つきの共有 URL',
    'HTML と script は使えません',
    'AI エージェントは下書きまで',
    '一般公開中の間だけ',
  ])
    expect(text).not.toContain(gone)
  await page.close()
})

test('F26-AC60: Given a wide window, When text is typed, Then the article stands on the right as the viewer draws it, updated soon after, and kept in view', async () => {
  const { page } = await openEditor(cookie, 1280)
  const pane = page.locator('[data-article-pane]')
  const input = await box(page).boundingBox()
  const side = (await pane.boundingBox())!
  expect(side.x).toBeGreaterThan(input!.x + input!.width - 1)
  expect(await pane.evaluate((el) => getComputedStyle(el).position)).toBe(
    'sticky',
  )
  await type(page, '# Live heading\n\nWords.')
  await expect
    .poll(() => pane.locator('h3').textContent(), { timeout: 5_000 })
    .toBe('Live heading')
  expect(await pane.locator('.article-text').count()).toBe(1)
  // A link in the pane leads nowhere: the box is not left.
  await type(page, '\n\n[out](https://example.com/)')
  await expect.poll(() => pane.locator('a').count(), { timeout: 5_000 }).toBe(1)
  await pane.locator('a').click()
  expect(new URL(page.url()).pathname).toBe('/slides/talk/article')
  await page.close()
})

test('F26-AC61: Given a window under 1100px, When the page opens, Then the article is not shown beside the box and nothing is asked of the server for it', async () => {
  const { page } = await openEditor(cookie, 1000)
  const renders: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/article/render')) renders.push(request.url())
  })
  await type(page, 'text')
  await expect
    .poll(() => status(page).innerText(), { timeout: 10_000 })
    .toContain('保存しました')
  expect(await page.locator('[data-article-pane]').isVisible()).toBe(false)
  expect(renders).toEqual([])
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.close()
})

test('F26-AC65: Given a wide and a narrow window, When the editing page opens, Then the box shows 24 lines or more in monospace and nothing runs off the side', async () => {
  const wide = await openEditor(cookie, 1280)
  const lines = await box(wide.page).evaluate(
    (area) => area.clientHeight / parseFloat(getComputedStyle(area).lineHeight),
  )
  expect(lines).toBeGreaterThanOrEqual(24)
  expect(
    await box(wide.page).evaluate((a) => getComputedStyle(a).fontFamily),
  ).toMatch(/mono|Menlo|Consolas|monospace/i)
  await wide.page.close()
  const narrow = await openEditor(cookie, 375)
  expect(
    await narrow.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await narrow.page.close()
})

test('F26-AC48, F26-AC52, F26-AC54: Given a published article, When the author edits it, Then readers do not see the edit, the state says changes are not shown, and updating the publication shows it to readers', async () => {
  const { page } = await openEditor()
  await type(page, 'FIRST-PUBLISHED')
  await page.getByRole('button', { name: '公開する' }).click()
  await page.getByText('redirected').waitFor()
  const again = await openEditor()
  expect(
    await again.page.getByRole('button', { name: '公開を更新' }).isDisabled(),
  ).toBe(true)
  await box(again.page).fill('SECOND-EDIT')
  await box(again.page).press('End')
  await expect
    .poll(() => status(again.page).innerText(), { timeout: 10_000 })
    .toContain('保存しました')
  await expect
    .poll(() => again.page.locator('[data-pending-chip]').isVisible())
    .toBe(true)
  await expect
    .poll(() =>
      again.page.getByRole('button', { name: '公開を更新' }).isEnabled(),
    )
    .toBe(true)
  // A reader's browser: no session.
  const reader = await openEditor('')
  await reader.page.goto(`${TEST_ORIGIN}/@owner/talk`)
  const seen = await reader.page.locator('.viewer-article').innerText()
  expect(seen).toContain('FIRST-PUBLISHED')
  expect(seen).not.toContain('SECOND-EDIT')
  await again.page.getByRole('button', { name: '公開を更新' }).click()
  await again.page.getByText('redirected').waitFor()
  await reader.page.reload()
  const after = await reader.page.locator('.viewer-article').innerText()
  expect(after).toContain('SECOND-EDIT')
  await Promise.all([page.close(), again.page.close(), reader.page.close()])
})

test('F26-AC55: Given an edit of a published article, When the changes are discarded, Then the box holds the published text', async () => {
  const first = await openEditor()
  await type(first.page, 'PUBLISHED-TEXT')
  await first.page.getByRole('button', { name: '公開する' }).click()
  await first.page.getByText('redirected').waitFor()
  const { page } = await openEditor()
  await box(page).fill('AN-EDIT')
  await expect
    .poll(() => status(page).innerText(), { timeout: 10_000 })
    .toContain('保存しました')
  await page.getByRole('button', { name: '変更を破棄' }).click()
  await page.getByText('redirected').waitFor()
  await page.goto(`${TEST_ORIGIN}/slides/talk/article`)
  await expect.poll(() => box(page).inputValue()).toBe('PUBLISHED-TEXT')
  await Promise.all([first.page.close(), page.close()])
})

test('F26-AC57: Given the article open in two tabs, When both are edited, Then the second is told it was updated in another tab, nothing of it is saved, and its text stays', async () => {
  const a = await openEditor()
  const b = await openEditor()
  await type(a.page, 'from the first tab')
  await expect
    .poll(() => status(a.page).innerText(), { timeout: 10_000 })
    .toContain('保存しました')
  await type(b.page, 'from the second tab')
  await expect
    .poll(() => status(b.page).innerText(), { timeout: 10_000 })
    .toContain('別のタブで更新されています')
  expect(await box(b.page).inputValue()).toBe('from the second tab')
  expect((await stored())?.body).toBe('from the first tab')
  await Promise.all([a.page.close(), b.page.close()])
})
