import { openTestBrowser } from '../test-open-browser'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type Locator,
  type Page,
  type Request as PlaywrightRequest,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { eq } from 'drizzle-orm'
import { keepArticle } from '../articles/store'
import { citations, deployments, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { addLink } from '../links/store'
import {
  INVITED_ID,
  OWNER_ID,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

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
let ownerCookie = ''
let deckOrigin = ''

const SLIDES =
  '<!doctype html><title>Slides</title><h1 id="title">Slides</h1><p id="hash"></p>'

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

const paragraphs = Array.from({ length: 30 }, (_, index) =>
  `Paragraph ${index + 1} of the article. `.repeat(6),
)

beforeAll(async () => {
  await applyMigrations(db)
  ownerCookie = await signIn(env)
  await signIn(env, 'reader', { id: INVITED_ID, name: 'Reader' })
  // A deck with everything the viewer can show under the slides.
  const talk = await seedPublic(db, 'talk', 1, 'Talk')
  await putSlides(talk)
  deckOrigin = `https://d-${talk}.content.example`
  await orm
    .update(deployments)
    .set({ description: 'What the talk is about.' })
    .where(eq(deployments.id, talk))
  for (const [index, kind] of (
    ['video', 'article', 'other'] as const
  ).entries())
    await addLink(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      link: {
        kind,
        url: `https://example.com/${index}`,
        title: `Link ${index}`,
      },
      now: 1,
    })
  await keepArticle(db, {
    deckId: 'talk',
    status: 'published',
    citations: [],
    now: 5,
    body: [
      '# Notes',
      ...paragraphs.slice(0, 10),
      `${TEST_ORIGIN}/@owner/talk/3`,
      ...paragraphs.slice(10),
    ].join('\n\n'),
  })
  const citing = await seedPublic(db, 'citing', 2, 'Citing deck', INVITED_ID)
  await orm.insert(citations).values({
    deployment_id: citing,
    target_handle: 'owner',
    target_slug: 'talk',
    target_page: 0,
  })
  // A deck with nothing but its slides and its author.
  await seedPublic(db, 'bare', 3, 'Bare')
  // Slides with an article and nothing else for a right column.
  await seedPublic(db, 'talk-solo', 6, 'Solo')
  await keepArticle(db, {
    deckId: 'talk-solo',
    status: 'published',
    citations: [],
    now: 5,
    body: ['# Solo', ...paragraphs.slice(0, 5)].join('\n\n'),
  })
  // Slides with only a description.
  const described = await seedPublic(db, 'described', 5, 'Described')
  await orm
    .update(deployments)
    .set({ description: 'Only a description.' })
    .where(eq(deployments.id, described))
  // Slides that are not public: only their author sees them.
  await seedDeck(db, 'draft')
  await seedDeployment(db, 'draft')
  browser = await openTestBrowser(engine)
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

type Options = {
  width?: number
  height?: number
  signedIn?: boolean
  /** Runs before any script of the page, on every load. */
  init?: () => void
}

/** The viewer, answered by the Worker, with what the test needs set first. */
async function openViewer(path: string, options: Options = {}): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 1280, height: options.height ?? 800 },
    locale: 'ja-JP',
  })
  if (options.signedIn)
    await context.addCookies([
      {
        name: '__Host-slide_owner',
        value: ownerCookie.split('=')[1] ?? '',
        url: TEST_ORIGIN,
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])
  const page = await context.newPage()
  if (options.init) await page.addInitScript(options.init)
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
  await page.goto(`${TEST_ORIGIN}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => (window as unknown as { slidePage?: object }).slidePage !== undefined,
  )
  return page
}

const close = (page: Page) => page.context().close()

const box = async (locator: Locator) => {
  const found = await locator.boundingBox()
  if (!found) throw new Error('Not on screen')
  return found
}
const slide = (page: Page) => page.locator('.stage')
const head = (page: Page) => page.locator('.viewer-head')
const author = (page: Page) => page.locator('.viewer-author')
const description = (page: Page) => page.locator('.viewer-description')
const links = (page: Page) => page.locator('.related-links')
const article = (page: Page) => page.locator('[data-viewer-article]')
const cites = (page: Page) => page.locator('[data-reader-lists="cited-by"]')
const NO_HORIZONTAL_SCROLL = () =>
  document.documentElement.scrollWidth - window.innerWidth
const side = (page: Page) => page.locator('.viewer-side')
const layoutEl = (page: Page) => page.locator('.viewer-layout')

const parts = (page: Page) => [
  slide(page),
  head(page),
  page.locator('.viewer-author'),
  description(page),
  links(page),
  article(page),
  cites(page),
]

test('F03-AC129: Given a screen 1280px wide, When the viewer opens, Then the slides span it with square corners and the title and article stand below them', async () => {
  const page = await openViewer('/@owner/talk')
  const s = await box(slide(page))
  expect(s.x).toBe(0)
  expect(Math.abs(s.width - 1280)).toBeLessThan(1)
  expect(
    await page
      .locator('.stage > iframe')
      .evaluate((frame) => getComputedStyle(frame).borderRadius),
  ).toBe('0px')
  const h = await box(head(page))
  expect(h.y).toBeGreaterThanOrEqual(s.y + s.height - 1)
  expect(await page.evaluate(NO_HORIZONTAL_SCROLL)).toBeLessThanOrEqual(0)
  await close(page)
}, 30_000)

test('F03-AC129: Given a screen 1920px wide, When the viewer opens, Then the whole layout is 1600px wide and centered, the slides across all of it', async () => {
  const page = await openViewer('/@owner/talk', { width: 1920, height: 1200 })
  const s = await box(slide(page))
  expect(Math.abs(s.width - 1600)).toBeLessThan(1)
  expect(Math.abs(s.x - 160)).toBeLessThan(1)
  const column = await box(side(page))
  expect(column.x + column.width).toBeLessThanOrEqual(s.x + s.width)
  expect(column.x + column.width).toBeGreaterThan(s.x + s.width - 40)
  expect(await page.evaluate(NO_HORIZONTAL_SCROLL)).toBeLessThanOrEqual(0)
  await close(page)
}, 30_000)

test('F03-AC130: Given widths 761px and 760px, When the viewer opens, Then 761px is the wide layout and 760px is one column in the old order', async () => {
  const page = await openViewer('/@owner/talk', { width: 761 })
  expect(await layoutEl(page).getAttribute('data-side')).toBe('true')
  const wide = await box(side(page))
  expect(wide.x).toBeGreaterThan(400)
  await page.setViewportSize({ width: 760, height: 800 })
  await expect
    .poll(async () => (await box(page.locator('.viewer-author'))).x)
    .toBeLessThan(100)
  const tops = []
  for (const part of parts(page)) tops.push(await box(part))
  for (let i = 1; i < tops.length; i++) {
    expect(tops[i]!.y).toBeGreaterThanOrEqual(
      tops[i - 1]!.y + tops[i - 1]!.height - 1,
    )
    expect(tops[i]!.x).toBe(tops[0]!.x)
  }
  expect(await page.evaluate(NO_HORIZONTAL_SCROLL)).toBeLessThanOrEqual(0)
  await close(page)
}, 30_000)

test('F03-AC130, F03-AC117: Given a phone 375px wide, When the viewer opens, Then the slides run edge to edge and the named article follows the links', async () => {
  const page = await openViewer('/@owner/talk', { width: 375 })
  const s = await box(slide(page))
  expect(Math.abs(s.x)).toBeLessThan(1)
  expect(Math.abs(s.width - 375)).toBeLessThan(1)
  expect(await page.evaluate(NO_HORIZONTAL_SCROLL)).toBeLessThanOrEqual(0)
  const headings = await page.locator('main h2').allInnerTexts()
  expect(headings).not.toContain('記事')
  expect(await article(page).locator('h2').count()).toBe(0)
  expect(await article(page).getAttribute('aria-label')).toBe('記事')
  const linksBox = await box(links(page))
  const articleBox = await box(article(page))
  const gap = articleBox.y - (linksBox.y + linksBox.height)
  expect(gap).toBeGreaterThanOrEqual(0)
  expect(gap).toBeLessThan(60)
  await close(page)
}, 30_000)

test('F03-AC131: Given the viewer, When it opens, Then there is no layout button or menu, and nothing is kept in the browser', async () => {
  const page = await openViewer('/@owner/talk')
  expect(
    await page.locator('[role="menu"], [role="menuitemradio"]').count(),
  ).toBe(0)
  expect(await page.getByRole('button', { name: /レイアウト/ }).count()).toBe(0)
  expect(
    await page.evaluate(() => Object.keys(localStorage).join(',')),
  ).not.toContain('layout')
  await close(page)
}, 30_000)

test('F03-AC132: Given slides with a description, links and citations, When the article is read down the page, Then the title and article stand on the left, the author, description, links and citations on the right, and the right stays in view', async () => {
  const page = await openViewer('/@owner/talk', { height: 700 })
  expect(await layoutEl(page).getAttribute('data-side')).toBe('true')
  const [s, h, a] = [
    await box(slide(page)),
    await box(head(page)),
    await box(article(page)),
  ]
  expect(a.y).toBeGreaterThanOrEqual(h.y + h.height - 1)
  const column = await box(side(page))
  expect(column.x).toBeGreaterThanOrEqual(h.x + h.width)
  expect(column.y).toBeGreaterThanOrEqual(s.y + s.height - 1)
  expect(column.width).toBeGreaterThanOrEqual(280)
  for (const part of [
    page.locator('.viewer-author'),
    description(page),
    links(page),
    cites(page),
  ])
    expect((await box(part)).x).toBeGreaterThanOrEqual(column.x)
  expect(await side(page).evaluate((e) => getComputedStyle(e).position)).toBe(
    'sticky',
  )
  expect(await side(page).evaluate((e) => getComputedStyle(e).top)).toBe('16px')
  await page.evaluate(() => window.scrollTo(0, 1500))
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(1000)
  expect((await box(side(page))).y).toBeCloseTo(16, 0)
  expect(await page.evaluate(NO_HORIZONTAL_SCROLL)).toBeLessThanOrEqual(0)
  await close(page)
}, 30_000)

const citeColumns = (page: Page) =>
  cites(page)
    .locator('.deck-grid')
    .evaluate(
      (grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    )

test('F03-AC133: Given the citations of a deck, When the viewer is wide and when it is narrow, Then the cards are one across, as wide as the right column and 16:9, and the narrow layout is as before', async () => {
  const page = await openViewer('/@owner/talk')
  expect(await citeColumns(page)).toBe(1)
  const column = await box(side(page))
  const cover = await box(page.locator('.citations .deck-cover').first())
  expect(cover.width).toBeGreaterThan(column.width - 4)
  expect(Math.abs(cover.width / cover.height - 16 / 9)).toBeLessThan(0.05)
  await page.setViewportSize({ width: 700, height: 800 })
  await expect.poll(() => citeColumns(page)).toBe(2)
  await close(page)
}, 30_000)

test('F03-AC134: Given slides with nothing for a right column but the author, When the viewer is 1280px wide, Then the title and author stand in the left column at the same left edge as slides with a side', async () => {
  const bare = await openViewer('/@owner/bare')
  expect(await layoutEl(bare).getAttribute('data-side')).toBe('false')
  const s = await box(slide(bare))
  const h = await box(head(bare))
  const a = await box(author(bare))
  expect(h.y).toBeGreaterThanOrEqual(s.y + s.height - 1)
  expect(a.y).toBeGreaterThanOrEqual(h.y + h.height - 1)
  expect(Math.abs(a.x - h.x)).toBeLessThan(1)
  expect(await bare.evaluate(NO_HORIZONTAL_SCROLL)).toBeLessThanOrEqual(0)
  await close(bare)
  const sided = await openViewer('/@owner/talk')
  expect(await layoutEl(sided).getAttribute('data-side')).toBe('true')
  const sidedHead = await box(head(sided))
  await close(sided)
  expect(Math.abs(h.x - sidedHead.x)).toBeLessThan(1)
  expect(Math.abs(h.width - sidedHead.width)).toBeLessThan(1)
}, 30_000)

test('F03-AC134: Given the same slides with an article, When the viewer is 1920px wide, Then the article stands under the author in that left column', async () => {
  const page = await openViewer('/@owner/talk-solo', { width: 1920 })
  expect(await layoutEl(page).getAttribute('data-side')).toBe('false')
  const a = await box(article(page))
  const h = await box(head(page))
  expect(a.y).toBeGreaterThanOrEqual(h.y + h.height - 1)
  expect(Math.abs(a.x - h.x)).toBeLessThan(1)
  // The right column (at least 280px) stays empty beside it.
  expect(a.x + a.width).toBeLessThanOrEqual(160 + 1600 - 32 - 280 - 32)
  await close(page)
}, 30_000)

test('F03-AC129: Given the viewer 1280px wide, When it opens, Then the slides keep a gap below the header rule', async () => {
  const page = await openViewer('/@owner/talk')
  const headerBottom = await page
    .locator('header')
    .first()
    .evaluate((e) => e.getBoundingClientRect().bottom)
  const s = await box(slide(page))
  expect(s.y - headerBottom).toBeGreaterThanOrEqual(16)
  await close(page)
}, 30_000)

test('F03-AC135: Given slides with only a description, When the viewer opens wide, Then the right column holds the author and the description', async () => {
  const page = await openViewer('/@owner/described')
  expect(await layoutEl(page).getAttribute('data-side')).toBe('true')
  const column = await box(side(page))
  expect((await box(page.locator('.viewer-author'))).x).toBeGreaterThanOrEqual(
    column.x,
  )
  expect((await box(description(page))).x).toBeGreaterThanOrEqual(column.x)
  expect(await description(page).innerText()).toBe('Only a description.')
  await close(page)
}, 30_000)

test('F03-AC136: Given slides with no links, article or citations, When the viewer is narrow or wide, Then no empty part shows and nothing runs past the screen', async () => {
  const page = await openViewer('/@owner/bare', { width: 375 })
  const emptyParts = page.locator(
    '.related-links, [data-viewer-article], .citations, main h2',
  )
  for (const width of [375, 1280, 1920]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await emptyParts.count(), `${width}px`).toBe(0)
    expect(await author(page).isVisible(), `${width}px`).toBe(true)
    expect(
      await page.evaluate(NO_HORIZONTAL_SCROLL),
      `${width}px`,
    ).toBeLessThanOrEqual(0)
  }
  await close(page)
}, 30_000)

test.each([375, 1280])(
  'F03-AC137: Given %ipx, When the viewer opens, Then the slides stay 16:9 within the screen, and pressing the article’s page 3 moves the slides to page 3',
  async (width) => {
    const page = await openViewer('/@owner/talk', { width, height: 1000 })
    const frame = await box(page.locator('#deck'))
    expect(frame.height).toBeLessThanOrEqual(1000 - 190 + 1)
    if (frame.height < 1000 - 190 - 2)
      expect(frame.width / frame.height).toBeCloseTo(16 / 9, 1)
    await expect
      .poll(() => page.frames().some((f) => f.url().startsWith(deckOrigin)))
      .toBe(true)
    const link = page.getByRole('link', { name: 'スライドの 3 ページへ移る' })
    await link.scrollIntoViewIfNeeded()
    await link.click()
    await expect
      .poll(() =>
        page
          .frames()
          .find((f) => f.url().startsWith(deckOrigin))
          ?.url(),
      )
      .toBe(`${deckOrigin}/#3`)
    // The slides tell their page, and the address follows (F03-AC143).
    await expect.poll(() => new URL(page.url()).pathname).toBe('/@owner/talk/3')
    await close(page)
  },
  30_000,
)

test.skipIf(engineName === 'webkit')(
  'F03-AC138: Given slides only their author may open, When the author opens them wide, Then the notice and the slides stand within the screen and nothing runs past it',
  async () => {
    const page = await openViewer('/@owner/draft', { signedIn: true })
    const notice = page.locator('.viewer-notice').first()
    await expect.poll(() => notice.isVisible()).toBe(true)
    const n = await box(notice)
    expect(n.x).toBeGreaterThan(0)
    expect(n.x + n.width).toBeLessThan(1280)
    expect((await box(slide(page))).y).toBeGreaterThanOrEqual(n.y + n.height)
    expect(await page.evaluate(NO_HORIZONTAL_SCROLL)).toBeLessThanOrEqual(0)
    await close(page)
  },
  30_000,
)

test('F03-AC139: Given the viewer’s policy, When it is opened, Then no script or style is blocked and the page has no inline scripts', async () => {
  const page = await openViewer('/@owner/talk', {
    init: () => {
      document.addEventListener('securitypolicyviolation', (event) =>
        ((window as unknown as { __csp: string[] }).__csp ??= []).push(
          event.violatedDirective,
        ),
      )
    },
  })
  expect(
    await page.evaluate(
      () => (window as unknown as { __csp?: string[] }).__csp ?? [],
    ),
  ).toEqual([])
  expect(await page.content()).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/)
  await close(page)
}, 30_000)
