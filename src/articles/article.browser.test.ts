import { openTestBrowser } from '../test-open-browser'
import { drizzle } from 'drizzle-orm/d1'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import type { Browser, Dialog, Page } from 'playwright'
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

// Typing, waiting for saves and two tabs take longer than the default 5 seconds.
vi.setConfig({ testTimeout: 60_000 })

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
  browser = await openTestBrowser()
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
async function openEditor(
  as = cookie,
  width = 1280,
  path = '/slides/talk/article',
) {
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
  await page.goto(`${TEST_ORIGIN}${path}`)
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

/**
 * Types the text into the box, waits for it to be kept, and publishes it from
 * the slide's page, as the author does.
 */
async function publishText(text: string) {
  const editor = await openEditor()
  await type(editor.page, text)
  await expect
    .poll(async () => (await stored())?.body, { timeout: 10_000 })
    .toContain(text)
  const slide = await openEditor(cookie, 1280, '/slides/talk')
  await slide.page.getByRole('button', { name: '記事を公開する' }).click()
  await slide.page.getByText('redirected').waitFor()
}

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
  await page.getByRole('button', { name: 'ビューアーで見る' }).click()
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
  await page.getByRole('button', { name: 'ビューアーで見る' }).click()
  await page.locator('[data-article-preview]').waitFor()
  return page
}

test('F26-AC91, F26-AC36, F26-AC42: Given a wide window, When the author previews, Then the page is the viewer with the band above', async () => {
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

test('F26-AC43, F26-AC92, F26-AC91: Given a draft, When the editing page opens, Then there is no tab, the viewer button is at the top right of the row of the way back and 44px tall, and no button stands under the box', async () => {
  const { page } = await openEditor()
  expect(await page.getByRole('tab').count()).toBe(0)
  const back = (await page.locator('.back-link').boundingBox())!
  const view = page.getByRole('button', { name: 'ビューアーで見る' })
  const at = (await view.boundingBox())!
  expect(
    Math.abs(at.y + at.height / 2 - (back.y + back.height / 2)),
  ).toBeLessThan(20)
  expect(at.x).toBeGreaterThan(back.x + back.width)
  expect(at.height).toBeGreaterThanOrEqual(44)
  const row = (await page.locator('.article-top').boundingBox())!
  expect(at.x + at.width).toBeGreaterThan(row.x + row.width - 4)
  for (const gone of [
    '公開する',
    '記事を公開する',
    '記事の公開を止める',
    '公開記事を更新',
    '変更を取り消す',
    'プレビュー',
  ])
    expect(await page.getByRole('button', { name: gone }).count()).toBe(0)
  expect(await page.locator('.article-actions').count()).toBe(0)
  expect(await page.getByRole('link', { name: '書き方' }).count()).toBe(0)
  await page.close()
})

test('F26-AC92: Given a published article, When the editing page opens, Then update and undo stand under the box, in one row and 44px tall, and publishing and stopping are not on the page', async () => {
  const { page } = await publishedPage('PUBLISHED')
  const names = ['公開記事を更新', '変更を取り消す']
  const boxes = []
  for (const name of names)
    boxes.push((await page.getByRole('button', { name }).boundingBox())!)
  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x)
  for (const one of boxes) {
    expect(Math.abs(one.y - boxes[0]!.y)).toBeLessThan(2)
    expect(one.height).toBeGreaterThanOrEqual(44)
  }
  for (const gone of ['記事の公開を止める', '記事を公開する'])
    expect(await page.getByRole('button', { name: gone }).count()).toBe(0)
  await page.close()
})

test('F26-AC78, F26-AC79, F26-AC90: Given the slide’s page, When the article is a draft, published and stopped, Then its frame shows the state beside the heading and one button for it, with no explanation', async () => {
  const editor = await openEditor()
  await type(editor.page, 'kept text')
  await expect
    .poll(async () => (await stored())?.body, { timeout: 10_000 })
    .toBe('kept text')
  const { page } = await openEditor(cookie, 1280, '/slides/talk')
  const frame = page.locator('[data-deck-frame="article"]')
  const head = frame.locator('.article-frame-head')
  expect(await head.locator('h2').textContent()).toBe('記事')
  expect(await head.locator('.status-chip').first().textContent()).toBe(
    '下書き',
  )
  expect(
    await frame.getByRole('link', { name: '記事を編集する' }).count(),
  ).toBe(1)
  expect(
    await frame.getByRole('button', { name: '記事の公開を止める' }).count(),
  ).toBe(0)
  expect(await frame.innerText()).not.toContain('スライドの下に載る')
  // The text typed after the page was drawn is not what is published: it is stale.
  await frame.getByRole('button', { name: '記事を公開する' }).click()
  await page.getByText('redirected').waitFor()
  expect(await stored()).toMatchObject({
    status: 'published',
    body: 'kept text',
  })
  const live = await openEditor(cookie, 1280, '/slides/talk')
  const liveFrame = live.page.locator('[data-deck-frame="article"]')
  expect(await liveFrame.locator('.status-chip').first().textContent()).toBe(
    '公開中',
  )
  expect(
    await liveFrame.getByRole('button', { name: '記事を公開する' }).count(),
  ).toBe(0)
  await liveFrame.getByRole('button', { name: '記事の公開を止める' }).click()
  await live.page.getByText('redirected').waitFor()
  expect(await stored()).toMatchObject({ status: 'draft', body: 'kept text' })
})

test('F26-AC83: Given the slide’s page drawn before another tab changed the article, When its button is pressed, Then it is refused with the reason, and the article is as the other tab left it', async () => {
  const editor = await openEditor()
  await type(editor.page, 'first')
  await expect
    .poll(async () => (await stored())?.body, { timeout: 10_000 })
    .toBe('first')
  const { page } = await openEditor(cookie, 1280, '/slides/talk')
  await type(editor.page, ' and later')
  await expect
    .poll(async () => (await stored())?.body, { timeout: 10_000 })
    .toBe('first and later')
  await page.getByRole('button', { name: '記事を公開する' }).click()
  await page.getByText('別のタブで更新されています').waitFor()
  expect(await stored()).toMatchObject({
    status: 'draft',
    body: 'first and later',
  })
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

test('F26-AC95, F26-AC52, F26-AC81: Given a published article, When the author edits it, Then readers do not see the edit, the state says changes are not shown, and updating the publication shows it to readers', async () => {
  await publishText('FIRST-PUBLISHED')
  const again = await openEditor()
  await box(again.page).fill('SECOND-EDIT')
  await box(again.page).press('End')
  await expect
    .poll(() => status(again.page).innerText(), { timeout: 10_000 })
    .toContain('保存しました')
  await expect
    .poll(() => again.page.locator('[data-pending-chip]').isVisible())
    .toBe(true)
  // A reader's browser: no session.
  const reader = await openEditor('')
  await reader.page.goto(`${TEST_ORIGIN}/@owner/talk`)
  const seen = await reader.page.locator('.viewer-article').innerText()
  expect(seen).toContain('FIRST-PUBLISHED')
  expect(seen).not.toContain('SECOND-EDIT')
  await again.page.getByRole('button', { name: '公開記事を更新' }).click()
  await again.page.getByText('redirected').waitFor()
  await reader.page.reload()
  const after = await reader.page.locator('.viewer-article').innerText()
  expect(after).toContain('SECOND-EDIT')
  await Promise.all([again.page.close(), reader.page.close()])
})

test('F26-AC82: Given an edit of a published article, When the changes are discarded, Then the box holds the published text', async () => {
  await publishText('PUBLISHED-TEXT')
  const { page } = await openEditor()
  await box(page).fill('AN-EDIT')
  await expect
    .poll(() => status(page).innerText(), { timeout: 10_000 })
    .toContain('保存しました')
  await page.getByRole('button', { name: '変更を取り消す' }).click()
  await page.getByText('redirected').waitFor()
  await page.goto(`${TEST_ORIGIN}/slides/talk/article`)
  await expect.poll(() => box(page).inputValue()).toBe('PUBLISHED-TEXT')
  await page.close()
})

test('F26-AC83: Given the article open in two tabs, When both are edited, Then the second is told it was updated in another tab, nothing of it is saved, and its text stays', async () => {
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

test('F26-AC88, F26-AC83: Given tab A that was behind when its save was refused, When A presses preview and then back to editing and waits, Then it saves nothing by itself and tab B’s text stays', async () => {
  const a = await openEditor()
  const b = await openEditor()
  await type(a.page, 'from A')
  await expect
    .poll(() => status(a.page).innerText(), { timeout: 10_000 })
    .toContain('保存しました')
  await type(b.page, 'from B')
  await expect
    .poll(() => status(b.page).innerText(), { timeout: 10_000 })
    .toContain('別のタブで更新されています')
  // B was behind: its save was refused. A moves on without reloading.
  await type(a.page, ' more')
  await expect
    .poll(async () => (await stored())?.body, { timeout: 10_000 })
    .toContain('from A more')
  await b.page.getByRole('button', { name: 'ビューアーで見る' }).click()
  await b.page.getByRole('button', { name: '編集に戻る' }).click()
  await expect.poll(() => box(b.page).inputValue()).toContain('from B')
  await new Promise((resolve) => setTimeout(resolve, 3500))
  expect((await stored())?.body).toBe('from A more')
  expect((await stored())?.status).toBe('draft')
})

/** Publishes the text from the slide's page, and returns an editing page on it. */
async function publishedPage(text: string) {
  await publishText(text)
  return openEditor()
}

test('F26-AC86: Given a button pressed twice, When it is “discard” or “publish”, Then one request goes, the discarded text does not come back by autosave, and no conflict is shown', async () => {
  const { page } = await publishedPage('PUBLISHED')
  await box(page).fill('AN-EDIT')
  await expect
    .poll(async () => (await stored())?.draft_body, { timeout: 10_000 })
    .toBe('AN-EDIT')
  const posts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/article'))
      posts.push(request.url())
  })
  await page.getByRole('button', { name: '変更を取り消す' }).dblclick()
  await page.getByText('redirected').waitFor()
  await new Promise((resolve) => setTimeout(resolve, 3000))
  expect(posts).toHaveLength(1)
  expect(await stored()).toMatchObject({ body: 'PUBLISHED', draft_body: null })

  const again = await openEditor()
  await box(again.page).fill('SECOND')
  const more: string[] = []
  again.page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/article'))
      more.push(request.url())
  })
  await again.page.getByRole('button', { name: '公開記事を更新' }).dblclick()
  await again.page.getByText('redirected').waitFor()
  expect(more).toHaveLength(1)
  expect(await again.page.getByText('別のタブで更新されています').count()).toBe(
    0,
  )
  expect((await stored())?.body).toBe('SECOND')
})

test('F26-AC87: Given an autosave on its way and more typed after it, When update is pressed, Then the button waits for them, and the published text holds all that was typed', async () => {
  const { page } = await publishedPage('PUBLISHED')
  await page.route('**/article/autosave', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.fallback()
  })
  await type(page, ' first')
  // The save starts after the pause and is slow; type again, then press at once.
  await new Promise((resolve) => setTimeout(resolve, 1800))
  await type(page, ' second')
  await page.getByRole('button', { name: '公開記事を更新' }).click()
  await page.getByText('redirected').waitFor({ timeout: 20_000 })
  expect(await stored()).toMatchObject({
    status: 'published',
    draft_body: null,
  })
  expect((await stored())?.body).toBe('PUBLISHED first second')
})

test('F26-AC70: Given the server answers a save with each refusal, When the author types, Then too long is lifted by a shorter text, the others stop the saving with their own words, and the text stays', async () => {
  const cases = [
    [400, { error: 'invalid' }, '保存できませんでした。再読み込みしてください'],
    [401, { error: 'x' }, 'ログインが切れました'],
    [404, { error: 'not_found' }, 'このスライドは見つかりません'],
  ] as const
  for (const [code, json, words] of cases) {
    const { page } = await openEditor()
    let sent = 0
    await page.route('**/article/autosave', (route) => {
      sent += 1
      return route.fulfill({ status: code, json })
    })
    await type(page, 'text')
    await expect
      .poll(() => status(page).innerText(), { timeout: 10_000 })
      .toContain(words)
    // Saving has stopped for good: typing again sends nothing more.
    const once = sent
    await type(page, ' more')
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(sent).toBe(once)
    expect(await box(page).inputValue()).toBe('text more')
  }
})

test('F26-AC70: Given a save refused as too long, When the text is shortened, Then saving starts again and the words go', async () => {
  const { page } = await openEditor()
  let refuse = true
  await page.route('**/article/autosave', (route) =>
    refuse
      ? route.fulfill({ status: 400, json: { error: 'too_long' } })
      : route.fallback(),
  )
  await type(page, 'too much')
  await expect
    .poll(() => status(page).innerText(), { timeout: 10_000 })
    .toContain('長すぎる')
  refuse = false
  await type(page, '!')
  await expect
    .poll(() => status(page).innerText(), { timeout: 10_000 })
    .toContain('保存しました')
  expect((await stored())?.body).toBe('too much!')
})

test('F26-AC73, F26-AC75: Given the editing page, When it opens, Then the heading Article is not seen but the document has its h1, the box shows no label and has its own name, and says what to write while empty', async () => {
  const { page } = await openEditor()
  const h1 = page.locator('h1')
  expect(await h1.count()).toBe(1)
  expect(await h1.textContent()).toBe('記事の編集')
  expect(await h1.isVisible()).toBe(true) // clipped to a pixel, as screen readers still read it
  expect((await h1.boundingBox())!.width).toBeLessThanOrEqual(1)
  expect(
    await page.getByRole('heading', { name: '記事', exact: true }).count(),
  ).toBe(0)
  expect(await page.locator('label').count()).toBe(0)
  const field = page.getByRole('textbox', { name: '記事の本文(Markdown)' })
  expect(await field.count()).toBe(1)
  expect(await field.getAttribute('placeholder')).toBe(
    '発表で話したことを書きます。Markdown が使えます。',
  )
  // Typing takes the words away; they show again when it is empty.
  await field.fill('x')
  expect(await field.inputValue()).toBe('x')
  await field.fill('')
  expect(
    await field.evaluate((area) =>
      (area as HTMLTextAreaElement).matches(':placeholder-shown'),
    ),
  ).toBe(true)
  await page.close()
})

test('F26-AC74: Given the editing page, When it opens, Then the row above the box holds the state on the left and the Markdown guide on the right, the guide leads to the help, and no link is left below', async () => {
  await publishText('PUBLISHED')
  const { page } = await openEditor()
  const row = (await page.locator('.article-toolbar').boundingBox())!
  const chip = (await page
    .locator('.article-state .status-chip')
    .first()
    .boundingBox())!
  const guide = page.getByRole('link', { name: 'Markdown ガイド' })
  const at = (await guide.boundingBox())!
  expect(
    await page.getByRole('link', { name: 'Markdown ガイド' }).count(),
  ).toBe(1)
  expect(at.height).toBeGreaterThanOrEqual(44)
  expect(chip.x).toBeLessThan(row.x + 60)
  expect(at.x + at.width).toBeGreaterThan(row.x + row.width - 4)
  // The row is above the box and the buttons.
  const input = (await box(page).boundingBox())!
  expect(row.y + row.height).toBeLessThanOrEqual(input.y + 1)
  expect(await guide.getAttribute('href')).toBe('/help#article')
  expect(await page.getByText('書き方').count()).toBe(0)
  // The save state goes in the same row.
  await type(page, ' more')
  await expect
    .poll(
      () => page.locator('.article-toolbar [data-autosave-status]').innerText(),
      { timeout: 10_000 },
    )
    .toContain('保存しました')
  await Promise.all([
    page.waitForURL(`${TEST_ORIGIN}/help#article`),
    guide.click(),
  ])
  await page.close()
})

test('F26-AC76: Given a wide window, When the page opens with an article beside the box, Then the top of the box and the top of the frame beside it are within a pixel', async () => {
  const { page } = await openEditor(cookie, 1280)
  const input = (await box(page).boundingBox())!
  const pane = (await page.locator('[data-article-pane]').boundingBox())!
  expect(Math.abs(input.y - pane.y)).toBeLessThanOrEqual(1)
  expect(pane.x).toBeGreaterThan(input.x + input.width - 1)
  await page.close()
})

test('F26-AC77: Given a narrow and a mid-width window, When the page opens, Then the row above the box wraps without breaking and nothing runs off the side', async () => {
  for (const width of [375, 1000]) {
    const { page } = await openEditor(cookie, width)
    await type(page, 'x')
    await expect
      .poll(() => status(page).innerText(), { timeout: 10_000 })
      .toContain('保存しました')
    const row = (await page.locator('.article-toolbar').boundingBox())!
    const guide = (await page
      .getByRole('link', { name: 'Markdown ガイド' })
      .boundingBox())!
    expect(guide.x + guide.width).toBeLessThanOrEqual(row.x + row.width + 1)
    expect(guide.x).toBeGreaterThanOrEqual(row.x - 1)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.close()
  }
})

test('F26-AC94: Given a notice after an action, When the editing page shows it at 1280 and 375, Then the viewer button stands 16px above whatever comes next, notice or toolbar', async () => {
  await publishText('PUBLISHED')
  for (const width of [1280, 375])
    for (const path of [
      '/slides/talk/article?result=updated',
      '/slides/talk/article',
    ]) {
      const { page } = await openEditor(cookie, width, path)
      const gap = await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find(
          (one) => one.textContent?.trim() === 'ビューアーで見る',
        )!
        const top = button.closest('.article-top')!
        let next = top.nextElementSibling as HTMLElement | null
        while (next && next.offsetHeight === 0)
          next = next.nextElementSibling as HTMLElement | null
        return (
          next!.getBoundingClientRect().top - top.getBoundingClientRect().bottom
        )
      })
      expect(Math.abs(gap - 16)).toBeLessThanOrEqual(1)
      await page.close()
    }
})
