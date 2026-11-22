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
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { VIEWER_LAYOUT_KEY, type ViewerLayout } from './viewer-layout'

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
  await resetTables(db)
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
  // Slides that are not public: only their author sees them.
  await seedDeck(db, 'draft')
  await seedDeployment(db, 'draft')
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

type Options = {
  width?: number
  height?: number
  signedIn?: boolean
  /** Runs before any script of the page, on every load. */
  init?: () => void
  /** A value kept under the layout key before the page's scripts run. */
  kept?: string
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
  if (options.kept !== undefined)
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key!, value!),
      [VIEWER_LAYOUT_KEY, options.kept],
    )
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
  // The script has run once the layout button is offered, wide screens only.
  await page.waitForFunction(
    () => (window as unknown as { slidePage?: object }).slidePage !== undefined,
  )
  return page
}

const close = (page: Page) => page.context().close()

const layoutOf = (page: Page) =>
  page.locator('[data-viewer-layout]').getAttribute('data-layout')
const toggle = (page: Page) => page.locator('[data-layout-toggle]')
const menu = (page: Page) =>
  page.locator('[role="menu"][aria-label="レイアウト"]')
const choice = (page: Page, name: string) =>
  page.getByRole('menuitemradio', { name })

const box = async (locator: Locator) => {
  const found = await locator.boundingBox()
  if (!found) throw new Error('Not on screen')
  return found
}
const stored = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), VIEWER_LAYOUT_KEY)
const keep = (page: Page, value: string) =>
  page.evaluate(
    ([key, v]) => localStorage.setItem(key!, v!),
    [VIEWER_LAYOUT_KEY, value],
  )

const slide = (page: Page) => page.locator('.stage')
const head = (page: Page) => page.locator('.viewer-head')
const author = (page: Page) => page.locator('.viewer-author')
const description = (page: Page) => page.locator('.viewer-description')
const links = (page: Page) => page.locator('.related-links')
const article = (page: Page) => page.locator('[data-viewer-article]')
const cites = (page: Page) => page.locator('[data-reader-lists="cited-by"]')

const NO_HORIZONTAL_SCROLL = () =>
  document.documentElement.scrollWidth - window.innerWidth

test('F03-AC105: Given nothing kept in the browser, When the viewer opens, Then the parts stand in one column: slides, title, author, description, links, article, citations', async () => {
  const page = await openViewer('/@owner/talk')
  expect(await layoutOf(page)).toBe('stack')
  const tops = []
  for (const part of [
    slide(page),
    head(page),
    author(page),
    description(page),
    links(page),
    article(page),
    cites(page),
  ])
    tops.push(await box(part))
  for (let i = 1; i < tops.length; i++) {
    expect(tops[i]!.y).toBeGreaterThanOrEqual(
      tops[i - 1]!.y + tops[i - 1]!.height - 1,
    )
    expect(tops[i]!.x).toBe(tops[0]!.x)
  }
  await close(page)
}, 30_000)

test('F03-AC106: Given the viewer on a wide screen, When it opens, Then the layout button sits in the title’s row before full screen, with a name, a menu that is closed, and the stack’s icon', async () => {
  const page = await openViewer('/@owner/talk')
  const button = toggle(page)
  await expect.poll(() => button.isVisible()).toBe(true)
  expect(await button.getAttribute('aria-label')).toBe(
    'レイアウトを選ぶ(いまは縦並び)',
  )
  expect(await button.getAttribute('aria-haspopup')).toBe('menu')
  expect(await button.getAttribute('aria-expanded')).toBe('false')
  const full = await box(page.getByRole('button', { name: '全画面' }))
  const layout = await box(button)
  const title = await box(page.locator('.viewer-title h1'))
  expect(layout.x + layout.width).toBeLessThanOrEqual(full.x)
  expect(Math.abs(layout.y - full.y)).toBeLessThan(4)
  expect(layout.x).toBeGreaterThan(title.x + title.width - 1)
  const visibleIcons = await button
    .locator('[data-layout-icon]')
    .evaluateAll((icons) =>
      icons
        .filter((icon) => getComputedStyle(icon).display !== 'none')
        .map((icon) => icon.getAttribute('data-layout-icon')),
    )
  expect(visibleIcons).toEqual(['stack'])
  expect(await menu(page).count()).toBe(1)
  expect(await menu(page).isVisible()).toBe(false)
  await close(page)
}, 30_000)

test('F03-AC107: Given the layout button, When it is pressed, Then a menu opens with three radio items, the chosen one checked with a mark', async () => {
  const page = await openViewer('/@owner/talk')
  await toggle(page).click()
  await expect.poll(() => menu(page).isVisible()).toBe(true)
  expect(await toggle(page).getAttribute('aria-expanded')).toBe('true')
  const items = page.getByRole('menuitemradio')
  expect(
    (await items.allTextContents()).map((text) => text.replace('✓', '').trim()),
  ).toEqual(['縦並び', '横並び', 'ワイド'])
  expect(
    await items.evaluateAll((all) =>
      all.map((item) => item.getAttribute('aria-checked')),
    ),
  ).toEqual(['true', 'false', 'false'])
  const marks = await items.evaluateAll((all) =>
    all.map((item) => ({
      mark: getComputedStyle(item.querySelector('.layout-mark')!).visibility,
      background: getComputedStyle(item).backgroundColor,
    })),
  )
  expect(marks.map((m) => m.mark)).toEqual(['visible', 'hidden', 'hidden'])
  expect(marks[0]!.background).not.toBe(marks[1]!.background)
  await close(page)
}, 30_000)

test('F03-AC108: Given the open menu, When the reader chooses side by side, Then the menu closes, the layout changes, and the button shows its icon and name', async () => {
  const page = await openViewer('/@owner/talk')
  await toggle(page).click()
  await choice(page, '横並び').click()
  await expect.poll(() => layoutOf(page)).toBe('side')
  await expect.poll(() => menu(page).isVisible()).toBe(false)
  expect(await toggle(page).getAttribute('aria-expanded')).toBe('false')
  expect(await toggle(page).getAttribute('aria-label')).toBe(
    'レイアウトを選ぶ(いまは横並び)',
  )
  expect(
    await toggle(page)
      .locator('[data-layout-icon]')
      .evaluateAll((icons) =>
        icons
          .filter((icon) => getComputedStyle(icon).display !== 'none')
          .map((icon) => icon.getAttribute('data-layout-icon')),
      ),
  ).toEqual(['side'])
  await toggle(page).click()
  expect(
    await page.getByRole('menuitemradio', { checked: true }).innerText(),
  ).toContain('横並び')
  await close(page)
}, 30_000)

test('F03-AC109: Given the open menu, When the reader presses the button again, presses outside, or presses Escape, Then it closes; and with the keyboard they can choose', async () => {
  const page = await openViewer('/@owner/talk')
  const open = async () => {
    await toggle(page).click()
    await expect.poll(() => menu(page).isVisible()).toBe(true)
  }
  await open()
  await toggle(page).click()
  await expect.poll(() => menu(page).isVisible()).toBe(false)

  await open()
  await page.locator('.viewer-title h1').click()
  await expect.poll(() => menu(page).isVisible()).toBe(false)

  await open()
  await page.keyboard.press('Escape')
  await expect.poll(() => menu(page).isVisible()).toBe(false)
  expect(
    await toggle(page).evaluate(
      (element) => element === document.activeElement,
    ),
  ).toBe(true)

  // Keyboard only: ArrowDown opens on the chosen item, arrows move, Enter chooses.
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => menu(page).isVisible()).toBe(true)
  expect(
    await page.evaluate(() => document.activeElement?.textContent?.trim()),
  ).toContain('縦並び')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect.poll(() => layoutOf(page)).toBe('wide')
  await expect.poll(() => menu(page).isVisible()).toBe(false)
  expect(
    await toggle(page).evaluate(
      (element) => element === document.activeElement,
    ),
  ).toBe(true)
  await close(page)
}, 30_000)

test('F03-AC110: Given a chosen layout, When the page is loaded again, and another slides’ viewer is opened, Then the same layout shows, kept under slide-viewer-layout', async () => {
  const page = await openViewer('/@owner/talk')
  await toggle(page).click()
  await choice(page, 'ワイド').click()
  await expect.poll(() => stored(page)).toBe('wide')
  await page.reload()
  await expect.poll(() => layoutOf(page)).toBe('wide')
  await page.goto(`${TEST_ORIGIN}/@owner/bare`)
  await expect.poll(() => layoutOf(page)).toBe('wide')
  await close(page)
}, 30_000)

test.each(['', 'sticky', 'WIDE', '{"layout":"wide"}'])(
  'F03-AC111: Given the kept value %j, When the viewer opens, Then it is the stack and the page works',
  async (value) => {
    const page = await openViewer('/@owner/talk')
    await keep(page, value)
    await page.reload()
    await expect.poll(() => toggle(page).isVisible()).toBe(true)
    expect(await layoutOf(page)).toBe('stack')
    await toggle(page).click()
    await choice(page, '横並び').click()
    await expect.poll(() => layoutOf(page)).toBe('side')
    await close(page)
  },
  30_000,
)

test('F03-AC112: Given a browser whose storage throws, When the reader chooses a layout, Then the page does not break and the choice holds for the visit', async () => {
  const errors: string[] = []
  const page = await openViewer('/@owner/talk', {
    init: () => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('denied', 'SecurityError')
        },
      })
    },
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await expect.poll(() => toggle(page).isVisible()).toBe(true)
  expect(await layoutOf(page)).toBe('stack')
  await toggle(page).click()
  await choice(page, 'ワイド').click()
  await expect.poll(() => layoutOf(page)).toBe('wide')
  await toggle(page).click()
  await choice(page, '横並び').click()
  await expect.poll(() => layoutOf(page)).toBe('side')
  expect(errors).toEqual([])
  await close(page)
}, 30_000)

test.each(['side', 'wide'])(
  'F03-AC113: Given %s kept, When the screen is 375px wide, Then the stack shows with no layout button, and nothing runs past the screen',
  async (kept) => {
    const page = await openViewer('/@owner/talk', {
      width: 375,
      height: 800,
      kept,
    })
    await expect.poll(() => layoutOf(page)).toBe(kept)
    expect(await toggle(page).isVisible()).toBe(false)
    const tops = []
    for (const part of [
      slide(page),
      head(page),
      author(page),
      description(page),
      links(page),
      article(page),
      cites(page),
    ])
      tops.push((await box(part)).y)
    expect(tops).toEqual([...tops].sort((a, b) => a - b))
    expect(await page.evaluate(NO_HORIZONTAL_SCROLL)).toBeLessThanOrEqual(0)
    await close(page)
  },
  30_000,
)

test('F03-AC113: Given a screen 761px wide, When the viewer opens, Then the layout button shows', async () => {
  const page = await openViewer('/@owner/talk', { width: 761 })
  await expect.poll(() => toggle(page).isVisible()).toBe(true)
  await page.setViewportSize({ width: 760, height: 800 })
  await expect.poll(() => toggle(page).isVisible()).toBe(false)
  await close(page)
}, 30_000)

async function chooseLayout(page: Page, name: string) {
  await toggle(page).click()
  await choice(page, name).click()
}

test('F03-AC114: Given side by side, When the article is read down the page, Then the slides, title and article stand on the left, and the author, description, links and citations stay in view on the right', async () => {
  const page = await openViewer('/@owner/talk', { height: 700 })
  await chooseLayout(page, '横並び')
  await expect.poll(() => layoutOf(page)).toBe('side')
  const [s, h, a] = [
    await box(slide(page)),
    await box(head(page)),
    await box(article(page)),
  ]
  expect(h.y).toBeGreaterThanOrEqual(s.y + s.height - 1)
  expect(a.y).toBeGreaterThanOrEqual(h.y + h.height - 1)
  const side = page.locator('.viewer-side')
  const column = await box(side)
  expect(column.x).toBeGreaterThanOrEqual(s.x + s.width)
  expect(column.width).toBeGreaterThanOrEqual(280)
  expect(column.width).toBeGreaterThan(1280 / 4)
  expect(column.width).toBeLessThan(1280 / 2.5)
  for (const part of [
    author(page),
    description(page),
    links(page),
    cites(page),
  ])
    expect((await box(part)).x).toBeGreaterThanOrEqual(column.x)
  expect(await side.evaluate((e) => getComputedStyle(e).position)).toBe(
    'sticky',
  )
  expect(await side.evaluate((e) => getComputedStyle(e).top)).toBe('16px')
  // Reading on: the article scrolls away and the side stays.
  await page.evaluate(() => window.scrollTo(0, 600))
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(300)
  const kept = await box(side)
  expect(kept.y).toBeCloseTo(16, 0)
  expect((await box(article(page))).y).toBeLessThan(0 + a.y)
  expect(await page.evaluate(NO_HORIZONTAL_SCROLL)).toBeLessThanOrEqual(0)
  await close(page)
}, 30_000)

test('F03-AC115: Given wide, When the viewer opens, Then the slides span the screen with square corners, and below them the title and article stand on the left and the side on the right', async () => {
  const page = await openViewer('/@owner/talk', { height: 700 })
  await chooseLayout(page, 'ワイド')
  await expect.poll(() => layoutOf(page)).toBe('wide')
  const s = await box(slide(page))
  expect(s.x).toBe(0)
  expect(Math.abs(s.width - 1280)).toBeLessThan(1)
  expect(
    await page
      .locator('.stage > iframe')
      .evaluate((frame) => getComputedStyle(frame).borderRadius),
  ).toBe('0px')
  const h = await box(head(page))
  const column = await box(page.locator('.viewer-side'))
  expect(h.y).toBeGreaterThanOrEqual(s.y + s.height - 1)
  expect(column.y).toBeGreaterThanOrEqual(s.y + s.height - 1)
  expect(column.x).toBeGreaterThan(h.x + h.width - 1)
  expect((await box(article(page))).x).toBe(h.x)
  expect(
    await page
      .locator('.viewer-side')
      .evaluate((e) => getComputedStyle(e).position),
  ).toBe('sticky')
  expect(await page.evaluate(NO_HORIZONTAL_SCROLL)).toBeLessThanOrEqual(0)
  await close(page)
}, 30_000)

test('F03-AC116: Given each layout, When the parts are listed in the order of the markup, Then it is the same in all three', async () => {
  const page = await openViewer('/@owner/talk')
  const order = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-viewer-layout] *')]
        .filter((e) =>
          e.matches(
            '.stage, .viewer-head, .viewer-author, .viewer-description, .related-links, [data-reader-lists], [data-viewer-article]',
          ),
        )
        .map((e) => e.className || e.getAttribute('data-reader-lists')),
    )
  const stack = await order()
  expect(stack).toHaveLength(8)
  for (const name of ['横並び', 'ワイド', '縦並び']) {
    await chooseLayout(page, name)
    expect(await order()).toEqual(stack)
  }
  await close(page)
}, 30_000)

test('F03-AC117: Given a deck with an article, When the viewer opens in any layout, Then no heading says “記事”, and the article’s text follows the links', async () => {
  const page = await openViewer('/@owner/talk')
  for (const name of ['縦並び', '横並び', 'ワイド']) {
    await chooseLayout(page, name)
    const headings = await page
      .locator('main h2, main h1, [data-viewer-article] h2')
      .allInnerTexts()
    expect(headings).not.toContain('記事')
    expect(await article(page).locator('h2').count()).toBe(0)
    expect(await article(page).getAttribute('aria-label')).toBe('記事')
    expect(
      await article(page).locator('.article-text h3').first().innerText(),
    ).toBe('Notes')
  }
  await chooseLayout(page, '縦並び')
  const l = await box(links(page))
  const a = await box(article(page))
  expect(a.y - (l.y + l.height)).toBeLessThan(60)
  await close(page)
}, 30_000)

test.each(['stack', 'side', 'wide'] as ViewerLayout[])(
  'F03-AC118: Given a deck with no links, article or citations, When it opens in %s, Then no empty part shows and nothing breaks',
  async (kept) => {
    const page = await openViewer('/@owner/bare', { kept })
    await expect.poll(() => layoutOf(page)).toBe(kept)
    expect(await links(page).count()).toBe(0)
    expect(await article(page).count()).toBe(0)
    expect(await page.locator('.citations').count()).toBe(0)
    expect(await page.locator('main h2').count()).toBe(0)
    expect(await author(page).isVisible()).toBe(true)
    const s = await box(slide(page))
    const h = await box(head(page))
    expect(h.y).toBeGreaterThanOrEqual(s.y + s.height - 1)
    expect(await page.evaluate(NO_HORIZONTAL_SCROLL)).toBeLessThanOrEqual(0)
    await close(page)
  },
  30_000,
)

test.each(['stack', 'side', 'wide'] as ViewerLayout[])(
  'F03-AC119: Given %s, When the viewer opens, Then the slides stay 16:9 within the screen, and pressing the article’s page 3 moves the slides to page 3',
  async (kept) => {
    const page = await openViewer('/@owner/talk', { height: 1000, kept })
    await expect.poll(() => layoutOf(page)).toBe(kept)
    const frame = await box(page.locator('#deck'))
    if (kept === 'wide') expect(Math.abs(frame.width - 1280)).toBeLessThan(1)
    expect(frame.height).toBeLessThanOrEqual(1000 - 190 + 1)
    const ratio = frame.width / frame.height
    // 16:9 unless the screen's height caps it, as before.
    expect(ratio).toBeGreaterThanOrEqual(16 / 9 - 0.02)
    if (frame.height < 1000 - 190 - 2) expect(ratio).toBeCloseTo(16 / 9, 1)
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
    expect(new URL(page.url()).pathname).toBe('/@owner/talk')
    await close(page)
  },
  30_000,
)

// WebKit does not send the owner's cookie through the routed requests, so the
// author's own viewer is not reached there; Chromium and Firefox run it.
test.skipIf(engineName === 'webkit').each(['side', 'wide'] as ViewerLayout[])(
  'F03-AC120: Given slides only their author may open, When the author opens them in %s, Then the notice and the slides stand within the screen and nothing runs past it',
  async (kept) => {
    const page = await openViewer('/@owner/draft', { signedIn: true, kept })
    await expect.poll(() => layoutOf(page)).toBe(kept)
    const notice = page.locator('.viewer-notice').first()
    await expect.poll(() => notice.isVisible()).toBe(true)
    const n = await box(notice)
    expect(n.x).toBeGreaterThan(0)
    expect(n.x + n.width).toBeLessThan(1280)
    const s = await box(slide(page))
    expect(s.y).toBeGreaterThanOrEqual(n.y + n.height)
    expect(await toggle(page).isVisible()).toBe(true)
    expect(await page.evaluate(NO_HORIZONTAL_SCROLL)).toBeLessThanOrEqual(0)
    await close(page)
  },
  30_000,
)

test('F03-AC121: Given the viewer’s policy, When the layout is chosen, Then no script or style is blocked and the page sends the same policy as before', async () => {
  const violations: string[] = []
  const page = await openViewer('/@owner/talk', {
    init: () => {
      document.addEventListener('securitypolicyviolation', (event) =>
        ((window as unknown as { __csp: string[] }).__csp ??= []).push(
          event.violatedDirective,
        ),
      )
    },
  })
  for (const name of ['横並び', 'ワイド', '縦並び'])
    await chooseLayout(page, name)
  violations.push(
    ...((await page.evaluate(
      () => (window as unknown as { __csp?: string[] }).__csp ?? [],
    )) as string[]),
  )
  expect(violations).toEqual([])
  const html = await page.content()
  expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/)
  const policy = (
    await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk`), env)
  ).headers.get('Content-Security-Policy')
  expect(policy).toContain("script-src 'self'")
  expect(policy).toContain("style-src 'unsafe-inline'")
  expect(policy).toContain("default-src 'none'")
  await close(page)
}, 30_000)

/** How many columns the citation cards are laid out in. */
const citeColumns = (page: Page) =>
  cites(page)
    .locator('.deck-grid')
    .evaluate(
      (grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    )

test('F03-AC122: Given the citations of a deck, When they show stacked, side by side and wide, Then the cards run three across stacked and two across in the narrow side', async () => {
  const page = await openViewer('/@owner/talk')
  expect(await citeColumns(page)).toBe(3)
  await chooseLayout(page, '横並び')
  await expect.poll(() => citeColumns(page)).toBe(2)
  await chooseLayout(page, 'ワイド')
  await expect.poll(() => citeColumns(page)).toBe(2)
  await chooseLayout(page, '縦並び')
  await expect.poll(() => citeColumns(page)).toBe(3)
  await close(page)
}, 30_000)
