import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser, type Dialog } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
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

test('F26-AC30: Given text typed and then previewed, When the author leaves, Then the browser still asks, as the text is not saved', async () => {
  const { page, dialogs } = await openEditor()
  await type(page, 'draft in progress')
  await page.getByRole('tab', { name: 'プレビュー' }).click()
  await page.getByRole('tab', { name: 'プレビュー', selected: true }).waitFor()
  await leave(page)
  expect(dialogs).toEqual(['beforeunload'])
})

test('F26-AC30: Given text typed, When the author presses save, Then the browser does not ask on the way out', async () => {
  const { page, dialogs } = await openEditor()
  await type(page, 'to be saved')
  await page.getByRole('button', { name: '下書きを保存' }).click()
  await page.getByText('redirected').waitFor()
  expect(dialogs).toEqual([])
})
