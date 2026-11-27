import { openTestBrowser } from '../test-open-browser'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test as plainTest } from 'vitest'
import {
  chromium,
  devices,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Route,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

/** The browser engine, chosen with BROWSER (chromium, webkit or firefox). */
const engineName = process.env.BROWSER ?? 'chromium'
const engine = { chromium, webkit, firefox }[engineName]
if (!engine) throw new Error(`Unknown BROWSER: ${engineName}`)

// Touches are sent through the DevTools protocol, which only Chromium has.
// WebKit does not reproduce iOS Safari's touch delivery either (see
// docs/dev/f03-sharing.md), so the real devices are a person's check.
const test = plainTest.skipIf(engineName !== 'chromium')

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const open_ = { limit: async () => ({ success: true }) }
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  VIEWER_RATE_LIMITER: open_,
  CONTENT_RATE_LIMITER: open_,
} as unknown as Env

/** Another site, where an author pastes the embed code. */
const BLOG = 'https://blog.example'

/**
 * What every deck here shares: it shows its page in #page, keeps it in the
 * fragment, and answers the arrow keys; a button sits in the right third.
 */
const COMMON = `
const clamp = (n) => Math.max(1, Math.min(9, n))
let page = clamp(Number(location.hash.slice(1)) || 1)
const show = (n, keep) => {
  page = clamp(n)
  document.querySelector('#page').textContent = String(page)
  if (!keep) history.replaceState(null, '', '#' + page)
}
addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') show(page + 1)
  else if (event.key === 'ArrowLeft') show(page - 1)
})
let clicks = 0
document.querySelector('#press').addEventListener('click', () => {
  document.querySelector('#clicks').textContent = String(++clicks)
})
`

/** Touch handling of the slides' own: a swipe and the thirds, at once. */
const OWN_TOUCH = `
let from = null
addEventListener('touchstart', (event) => {
  const t = event.changedTouches[0]
  from = { x: t.clientX, y: t.clientY }
})
addEventListener('touchend', (event) => {
  const t = event.changedTouches[0]
  if (!from) return
  const dx = t.clientX - from.x
  if (Math.abs(dx) >= 40) show(page + (dx < 0 ? 1 : -1))
  else if (from.x > innerWidth * 2 / 3) show(page + 1)
  else if (from.x < innerWidth / 3) show(page - 1)
  from = null
})
`

const deck = (script: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>t</title><style>
    html, body { margin: 0; height: 100% }
    #press { position: fixed; right: 0; top: 0; width: 80px; height: 80px }
    </style></head><body>
    <h1 id="page">1</h1><p id="clicks">0</p><button id="press">press</button>
    <script>${script}</script></body></html>`

const DECKS: Record<string, string> = {
  // Knows the keyboard only: the slides of the report (F03-AC202).
  keys: deck(COMMON),
  // Has a touch of its own, and shows the page in the fragment.
  own: deck(COMMON + OWN_TOUCH),
  // Keeps no page number in its fragment: the page is not known (F03-AC208).
  unknown: deck(
    COMMON.replace(
      'const show = (n, keep) => {',
      "history.replaceState(null, '', '#intro')\nconst show = (n) => {",
    ).replace("  if (!keep) history.replaceState(null, '', '#' + page)\n", ''),
  ),
}

async function store(id: string, html: string) {
  const key = `${id}/0/lease`
  await platform.env.UPLOADS.put(key, html)
  await orm.insert(uploadFiles).values({
    deployment_id: id,
    id: '0',
    path: 'index.html',
    size: html.length,
    sha256: 'a'.repeat(64),
    media_type: 'text/html; charset=utf-8',
    object_key: key,
  })
}

let browser: Browser
beforeAll(async () => {
  await applyMigrations(db)
  await signIn(env)
  for (const [index, [slug, html]] of Object.entries(DECKS).entries())
    await store(await seedPublic(db, slug, index + 1, slug), html)
  browser = await openTestBrowser(engine)
}, 60000)
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
}, 60000)

/** Answers the blog and the service's hosts, as Cloudflare would. */
async function serve(route: Route, article: string) {
  const request = route.request()
  const url = new URL(request.url())
  if (url.origin === BLOG)
    return route.fulfill({ contentType: 'text/html', body: article })
  if (
    url.hostname !== 'slide.example' &&
    !url.hostname.endsWith('.content.example')
  )
    return route.abort()
  const headers = await request.allHeaders()
  if (request.isNavigationRequest() && request.frame().parentFrame())
    headers['sec-fetch-dest'] ??= 'iframe'
  const response = await server.fetch(
    new Request(url, { method: request.method(), headers, redirect: 'manual' }),
    env,
  )
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: Buffer.from(await response.arrayBuffer()),
  })
}

type Setting = {
  page: Page
  cdp: CDPSession
  /** The frame element of the slides, and its box in the page. */
  frame: () => Promise<{ x: number; y: number; width: number; height: number }>
  page_: () => Promise<string | null>
  clicks: () => Promise<string | null>
}

/** A phone, with the slides opened in the viewer or in an article. */
async function onPhone(
  where: 'viewer' | 'article',
  slug: string,
  use: (setting: Setting) => Promise<void>,
) {
  const context: BrowserContext = await browser.newContext({
    ...devices['Pixel 7'],
  })
  try {
    const article = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Post</title><div style="width: 360px"><iframe src="${TEST_ORIGIN}/embed/@owner/${slug}" width="360" height="260" style="border:0"></iframe></div>`
    await context.route('**/*', (route) => serve(route, article))
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await page.goto(
      where === 'viewer' ? `${TEST_ORIGIN}/@owner/${slug}` : `${BLOG}/post`,
    )
    const inner =
      where === 'viewer'
        ? page.frameLocator('iframe#deck')
        : page.frameLocator('iframe').frameLocator('#deck')
    const outer =
      where === 'viewer'
        ? page.locator('iframe#deck')
        : page.locator('iframe').first()
    await expect.poll(() => inner.locator('#page').textContent()).toBe('1')
    // The viewer and the embed page are to have laid the frame out.
    await expect
      .poll(async () => (await outer.boundingBox())?.width ?? 0)
      .toBeGreaterThan(300)
    const frame = async () => {
      // For the article, the slides' frame is inside the embed's frame.
      const box =
        where === 'viewer'
          ? await outer.boundingBox()
          : await page
              .frames()
              .find((f) => f.url().includes('/embed/'))!
              .locator('iframe#deck')
              .boundingBox()
      if (!box) throw new Error('no frame')
      return box
    }
    await use({
      page,
      cdp,
      frame,
      page_: () => inner.locator('#page').textContent(),
      clicks: () => inner.locator('#clicks').textContent(),
    })
  } finally {
    await context.close()
  }
}

type At = { x: number; y: number }
const touches = (points: At[]) =>
  points.map((p, id) => ({ x: p.x, y: p.y, id }))

/** One finger, or several, from `from` to `to` (a tap when they are equal). */
async function touch(cdp: CDPSession, from: At[], to: At[] = from) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: touches(from),
  })
  if (to !== from)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: touches(to),
    })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
}

/** Where, inside the slides' frame, as fractions of its width and height. */
const within = (
  box: { x: number; y: number; width: number; height: number },
  fx: number,
  fy: number,
): At => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })

/** Long enough for a missing second turn to show: the wait, and more. */
const SETTLED = 600

test.each(['viewer', 'article'] as const)(
  'F03-AC202, F03-AC204: Given slides that know only the keyboard, in the %s, When the reader swipes left and then right, Then the next and the previous page show',
  async (where) => {
    await onPhone(where, 'keys', async ({ cdp, frame, page_ }) => {
      const box = await frame()
      const mid = (fx: number) => within(box, fx, 0.5)
      await touch(cdp, [mid(0.8)], [mid(0.3)])
      await expect.poll(page_).toBe('2')
      await touch(cdp, [mid(0.8)], [mid(0.3)])
      await expect.poll(page_).toBe('3')
      await touch(cdp, [mid(0.3)], [mid(0.8)])
      await expect.poll(page_).toBe('2')
    })
  },
  60000,
)

test.each(['viewer', 'article'] as const)(
  'F03-AC203, F03-AC204: Given slides that know only the keyboard, in the %s, When the reader taps the right, the right again, the left, and the middle, Then they go to the next, the next, the previous, and stay',
  async (where) => {
    await onPhone(where, 'keys', async ({ cdp, frame, page_ }) => {
      const box = await frame()
      // Below the button, which sits in the top right corner.
      const tap = (fx: number) => touch(cdp, [within(box, fx, 0.6)])
      await tap(0.9)
      await expect.poll(page_).toBe('2')
      await tap(0.9)
      await expect.poll(page_).toBe('3')
      await tap(0.1)
      await expect.poll(page_).toBe('2')
      await tap(0.5)
      await new Promise((resolve) => setTimeout(resolve, SETTLED))
      expect(await page_()).toBe('2')
    })
  },
  60000,
)

test('F03-AC205: Given slides with a swipe and thirds of their own, When the reader swipes once and taps once, Then each turns one page, not two', async () => {
  await onPhone('viewer', 'own', async ({ cdp, frame, page_ }) => {
    const box = await frame()
    await touch(cdp, [within(box, 0.8, 0.5)], [within(box, 0.3, 0.5)])
    await expect.poll(page_).toBe('2')
    await new Promise((resolve) => setTimeout(resolve, SETTLED))
    expect(await page_()).toBe('2')
    await touch(cdp, [within(box, 0.9, 0.6)])
    await expect.poll(page_).toBe('3')
    await new Promise((resolve) => setTimeout(resolve, SETTLED))
    expect(await page_()).toBe('3')
    // And once they have been seen to turn, a later touch is theirs alone.
    await touch(cdp, [within(box, 0.1, 0.6)])
    await expect.poll(page_).toBe('2')
    await new Promise((resolve) => setTimeout(resolve, SETTLED))
    expect(await page_()).toBe('2')
  })
}, 60000)

test('F03-AC206: Given a button in the right third, When the reader taps it, Then the button is pressed and the page does not turn', async () => {
  await onPhone('viewer', 'keys', async ({ cdp, frame, page_, clicks }) => {
    const box = await frame()
    await touch(cdp, [within(box, 1 - 40 / box.width, 40 / box.height)])
    await expect.poll(clicks).toBe('1')
    await new Promise((resolve) => setTimeout(resolve, SETTLED))
    expect(await page_()).toBe('1')
  })
}, 60000)

test('F03-AC207: Given slides that know only the keyboard, When the reader scrolls up and down, or touches with two fingers, Then the page does not turn', async () => {
  await onPhone('viewer', 'keys', async ({ cdp, frame, page_ }) => {
    const box = await frame()
    await touch(cdp, [within(box, 0.5, 0.2)], [within(box, 0.52, 0.8)])
    await touch(
      cdp,
      [within(box, 0.85, 0.6), within(box, 0.9, 0.6)],
      [within(box, 0.2, 0.6), within(box, 0.25, 0.6)],
    )
    await touch(cdp, [within(box, 0.9, 0.6), within(box, 0.95, 0.6)])
    await new Promise((resolve) => setTimeout(resolve, SETTLED))
    expect(await page_()).toBe('1')
  })
}, 60000)

test('F03-AC208: Given slides that keep no page number in their fragment, When the reader swipes and taps, Then the page does not turn', async () => {
  await onPhone('viewer', 'unknown', async ({ cdp, frame, page_ }) => {
    const box = await frame()
    await touch(cdp, [within(box, 0.8, 0.5)], [within(box, 0.3, 0.5)])
    await touch(cdp, [within(box, 0.9, 0.6)])
    await new Promise((resolve) => setTimeout(resolve, SETTLED))
    expect(await page_()).toBe('1')
  })
}, 60000)
