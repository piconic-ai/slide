import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type Page,
  type Request as PlaywrightRequest,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { keepArticle } from './store'

/** The browser engine, chosen with BROWSER as the viewer's own test is. */
const engineName = process.env.BROWSER ?? 'chromium'
const engine = { chromium, webkit, firefox }[engineName]
if (!engine) throw new Error(`Unknown BROWSER: ${engineName}`)

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let browser: Browser
let deckOrigin = ''

const SLIDES =
  '<!doctype html><title>Slides</title><h1 id="title">Slides</h1><p id="hash"></p>' +
  '<script>const show = () => (document.querySelector("#hash").textContent = location.hash);' +
  'addEventListener("hashchange", show); show()</script>'

async function putSlides(id: string) {
  const key = `${id}/0/lease`
  await platform.env.UPLOADS.put(key, SLIDES)
  await orm.insert(uploadFiles).values({
    deployment_id: id,
    id: '0',
    path: 'index.html',
    size: SLIDES.length,
    sha256: Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SLIDES)),
    ).toString('hex'),
    media_type: 'text/html; charset=utf-8',
    object_key: key,
  })
}

beforeAll(async () => {
  await applyMigrations(db)
  await resetTables(db)
  await signIn(env)
  await signIn(env, 'reader', { id: INVITED_ID, name: 'Reader' })
  const id = await seedPublic(db, 'talk', 1, 'Talk')
  await putSlides(id)
  deckOrigin = `https://d-${id}.content.example`
  await seedPublic(db, 'open', 2, 'Open deck', INVITED_ID)
  await keepArticle(db, {
    deckId: 'talk',
    status: 'published',
    citations: [],
    now: 5,
    body: [
      ...Array.from(
        { length: 12 },
        (_, index) => `Paragraph ${index + 1} of the article.`,
      ),
      `${TEST_ORIGIN}/@owner/talk/3`,
      `${TEST_ORIGIN}/@reader/open/5`,
    ].join('\n\n'),
  })
  browser = await engine.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

const isServed = (url: URL) =>
  url.hostname === 'slide.example' || url.hostname.endsWith('.content.example')

async function forwarded(request: PlaywrightRequest) {
  const headers = await request.allHeaders()
  return 'sec-fetch-dest' in headers ||
    !request.isNavigationRequest() ||
    !request.frame().parentFrame()
    ? headers
    : { ...headers, 'sec-fetch-dest': 'iframe' }
}

/** The viewer, answered by the Worker, in a window short enough to need scrolling. */
async function openViewer(path = '/@owner/talk'): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1000, height: 500 } })
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!isServed(url)) return route.abort()
    const response = await server.fetch(
      new Request(url, {
        method: request.method(),
        headers: await forwarded(request),
        redirect: 'manual',
      }),
      env,
    )
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}${path}`)
  return page
}

const slidesFrame = (page: Page) =>
  page.frames().find((frame) => frame.url().startsWith(deckOrigin))

test('F26-AC18: Given the article’s own page 3 as an image, When it is pressed, Then the slides above move to page 3 without reloading, and the slides are brought into view', async () => {
  const page = await openViewer()
  await expect.poll(() => slidesFrame(page) !== undefined).toBe(true)
  const slides = slidesFrame(page)!
  await slides.waitForSelector('#title', { timeout: 3000 })
  // The viewer starts with the article out of view, and the slides at the top.
  const link = page.getByRole('link', { name: 'スライドの 3 ページへ移る' })
  await link.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
  const loadedAt = await slides.evaluate(() => performance.timeOrigin)
  const viewerLoadedAt = await page.evaluate(() => performance.timeOrigin)
  await link.click()
  await expect.poll(() => slidesFrame(page)?.url()).toBe(`${deckOrigin}/#3`)
  // The slides' own script was told by the fragment, and was not reloaded.
  await expect
    .poll(() => slidesFrame(page)!.evaluate(() => location.hash))
    .toBe('#3')
  expect(await slidesFrame(page)!.evaluate(() => performance.timeOrigin)).toBe(
    loadedAt,
  )
  // The page itself did not move to another page; its address follows the
  // page the slides tell (F03-AC143).
  await expect.poll(() => new URL(page.url()).pathname).toBe('/@owner/talk/3')
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(viewerLoadedAt)
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const top = document.querySelector('#deck')!.getBoundingClientRect().top
        return top >= -2 && top < 120
      }),
    )
    .toBe(true)
  await page.close()
}, 30_000)

test('F26-AC20: Given another author’s page 5 as an image, When it is pressed, Then that slides’ viewer opens at page 5', async () => {
  const page = await openViewer()
  const link = page.getByRole('link', {
    name: 'Readerさんの『Open deck』5 ページを開く',
  })
  await link.scrollIntoViewIfNeeded()
  await Promise.all([
    page.waitForURL(`${TEST_ORIGIN}/@reader/open/5`),
    link.click(),
  ])
  expect(await page.title()).toContain('Open deck')
  await page.close()
}, 30_000)

test('F26-AC17: Given an image that cannot be read, When the article is shown, Then no broken-image mark shows and the page’s name does', async () => {
  const page = await openViewer()
  // The stand-in for the browser gives a cover for the own page; the other
  // page's image is the deck's cover path, which this deck lacks.
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll('.article-embed img[data-cover]')].map(
          (image) =>
            (image as HTMLImageElement).hidden ||
            (image as HTMLImageElement).complete,
        ),
      ),
    )
    .not.toContain(false)
  expect(await page.locator('.article-embed .deck-cover-name').count()).toBe(2)
  await page.close()
}, 30_000)
