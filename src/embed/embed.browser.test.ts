import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
  type Request as PlaywrightRequest,
  type Route,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import type { DeckSlug } from '../decks/deck-id'
import { uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import type { Handle } from '../share/handle'
import { embedCode, embedPath } from './code'

const engineName = process.env.BROWSER ?? 'chromium'
const engine = { chromium, webkit, firefox }[engineName]
if (!engine) throw new Error(`Unknown BROWSER: ${engineName}`)

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

/** Another site, where an author pastes the code into an article. */
const BLOG = 'https://blog.example'
const TITLE = 'Talk "one" <two> & more'

/**
 * Slides that turn pages, and try what a hostile deck would try on the page
 * around an embed. Whether an attempt went through is judged from outside:
 * requests, pages, downloads, and where the frames are.
 */
const DECK: Record<string, [string, string]> = {
  'index.html': [
    'text/html; charset=utf-8',
    `<!doctype html><title>Deck</title>
    <h1 id="page"></h1>
    <button id="next">next</button>
    <a id="other" href="${TEST_ORIGIN}/@owner/other">other slides</a>
    <a id="outside" href="https://elsewhere.example/page">another site</a>
    <a id="inside" href="/more/">more of these slides</a>
    <form id="form" action="/submit" method="post"><button>send</button></form>
    <script src="/deck.js"></script>`,
  ],
  'deck.js': [
    'text/javascript',
    `const page = () => Number(location.hash.slice(1) || 1)
    const show = () => (document.querySelector('#page').textContent = page())
    addEventListener('hashchange', show)
    show()
    const next = () => (location.hash = '#' + (page() + 1))
    document.querySelector('#next').addEventListener('click', next)
    addEventListener('keydown', (event) => event.key === 'ArrowRight' && next())
    const attempt = (stage) => {
      try { top.location.href = 'https://elsewhere.example/top-' + stage } catch {}
      try { parent.location.href = 'https://elsewhere.example/parent-' + stage } catch {}
      try { window.open('https://elsewhere.example/popup-' + stage) } catch {}
      try {
        const link = document.createElement('a')
        link.href = '/deck.js'
        link.download = 'deck.js'
        document.body.append(link)
        link.click()
      } catch {}
      try { document.querySelector('#form').requestSubmit() } catch {}
      document.body.dataset.attempted = stage
    }
    // Once on its own, and again with the reader's click behind it.
    addEventListener('load', () => attempt('load'))
    document.querySelector('#page').addEventListener('click', () => attempt('click'))`,
  ],
  'more/index.html': ['text/html', '<p id="more">more</p>'],
}

let browser: Browser
let ownerCookie = ''

beforeAll(async () => {
  await applyMigrations(db)
  await resetTables(db)
  ownerCookie = await signIn(env)
  const id = await seedPublic(db, 'talk', 1, TITLE)
  const orm = drizzle(db)
  for (const [index, [path, [type, body]]] of Object.entries(DECK).entries()) {
    const key = `${id}/${index}/lease`
    await platform.env.UPLOADS.put(key, body)
    const digest = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)),
    ).toString('hex')
    await orm.insert(uploadFiles).values({
      deployment_id: id,
      id: String(index),
      path,
      size: body.length,
      sha256: digest,
      media_type: type,
      object_key: key,
    })
  }
  browser = await engine.launch()
}, 60000)
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
}, 60000)

/** The article: the pasted code, and the viewer itself framed the same way. */
const article = (code: string) =>
  `<!doctype html><title>Post</title><h1>Article</h1>
  <div id="pasted" style="width: 640px">${code}</div>
  <iframe id="viewer" src="${TEST_ORIGIN}/@owner/talk" width="640" height="360"></iframe>
  <script>
    window.heard = []
    addEventListener('message', (event) => window.heard.push(event.origin))
  </script>`

type Observed = {
  requests: string[]
  downloads: string[]
  /** Requests to the service from inside the article, with their cookie. */
  service: { path: string; cookie: string | null; status: number }[]
}

/**
 * The headers the Worker would receive. Chromium adds Sec-Fetch-Dest after
 * interception, so a frame's navigation is given the value it sends on the
 * network.
 */
async function forwardedHeaders(request: PlaywrightRequest) {
  const headers = await request.allHeaders()
  return 'sec-fetch-dest' in headers ||
    !request.isNavigationRequest() ||
    !request.frame().parentFrame()
    ? headers
    : { ...headers, 'sec-fetch-dest': 'iframe' }
}

/** Answers the article's site itself and the service's hosts with the Worker. */
function serve(observed: Observed, code: string) {
  return async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === BLOG)
      return route.fulfill({ contentType: 'text/html', body: article(code) })
    const served =
      url.hostname === 'slide.example' ||
      url.hostname.endsWith('.content.example')
    if (!served) return route.abort()
    const headers = await forwardedHeaders(request)
    const response = await server.fetch(
      new Request(url, {
        method: request.method(),
        headers,
        redirect: 'manual',
      }),
      env,
    )
    if (url.hostname === 'slide.example')
      observed.service.push({
        path: url.pathname,
        cookie: headers.cookie ?? null,
        status: response.status,
      })
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  }
}

/** Opens the article with the code pasted, as a reader signed in on the service. */
async function withArticle(
  code: string,
  use: (
    page: Page,
    observed: Observed,
    context: BrowserContext,
  ) => Promise<void>,
) {
  const context = await browser.newContext({ locale: 'ja-JP' })
  try {
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
    const observed: Observed = { requests: [], downloads: [], service: [] }
    context.on('request', (request) => observed.requests.push(request.url()))
    context.on('page', (page) =>
      page.on('download', (download) =>
        observed.downloads.push(download.suggestedFilename()),
      ),
    )
    await context.route('**/*', serve(observed, code))
    const page = await context.newPage()
    await page.goto(`${BLOG}/post`)
    await use(page, observed, context)
  } finally {
    await context.close()
  }
}

const code = (page?: number) =>
  embedCode({
    src: `${TEST_ORIGIN}${embedPath('owner' as Handle, 'talk' as DeckSlug, page)}`,
    title: TITLE,
  })
const deckIn = (page: Page) =>
  page.frameLocator('#pasted iframe').frameLocator('#deck')

test('F25-AC1, F25-AC8: Given the embed code pasted into a page of another origin, When a reader opens that page, Then the slides show in one 16:9 frame named by their title and turn pages by click and by key', async () => {
  await withArticle(code(), async (page, observed) => {
    const deck = deckIn(page)
    await expect.poll(() => deck.locator('#page').textContent()).toBe('1')
    // The pasted code is one frame; the title's quotes and markup made nothing else.
    const pasted = await page.locator('#pasted').evaluate((box) => ({
      children: [...box.querySelectorAll('*')].map((child) => child.tagName),
      title: box.querySelector('iframe')?.title,
      width: box.querySelector('iframe')?.getBoundingClientRect().width,
      height: box.querySelector('iframe')?.getBoundingClientRect().height,
    }))
    expect(pasted.children).toEqual(['IFRAME'])
    expect(pasted.title).toBe(TITLE)
    expect([pasted.width, pasted.height]).toEqual([640, 360])

    await deck.locator('#next').click()
    await expect.poll(() => deck.locator('#page').textContent()).toBe('2')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => deck.locator('#page').textContent()).toBe('3')

    // Under the slides: the title, the author, and the way to the viewer.
    const line = page.frameLocator('#pasted iframe').locator('.embed-line')
    expect(await line.locator('.embed-title').textContent()).toBe(TITLE)
    const open = line.getByRole('link', { name: 'slide.community で開く' })
    expect(await open.getAttribute('href')).toBe(`${TEST_ORIGIN}/@owner/talk`)
    // The service was asked for the page to frame without the reader's session.
    const asked = observed.service.filter(({ path }) =>
      path.startsWith('/embed'),
    )
    expect(asked).toEqual([
      { path: '/embed/@owner/talk', cookie: null, status: 200 },
      { path: '/embed.js', cookie: null, status: 200 },
    ])
  })
}, 30000)

test('F25-AC10: Given the code for /embed/@handle/slug/3 pasted into another origin’s page, When a reader opens that page, Then the slides start on page 3', async () => {
  await withArticle(code(3), async (page) => {
    await expect
      .poll(() => deckIn(page).locator('#page').textContent())
      .toBe('3')
  })
}, 30000)

test('F25-AC2: Given the viewer’s own URL framed in the same page of another origin, When a reader opens that page, Then the viewer does not show there, and only the embed runs the slides', async () => {
  await withArticle(code(), async (page, observed) => {
    await expect
      .poll(() => deckIn(page).locator('#page').textContent())
      .toBe('1')
    // The service answered the framed share URL; the browser refused to show it.
    await expect
      .poll(() => observed.service.map(({ path }) => path))
      .toContain('/@owner/talk')
    await page.waitForTimeout(500)
    const framed = page.frames().map((frame) => frame.url())
    expect(
      framed.filter((url) => url.includes('.content.example')),
    ).toHaveLength(1)
    expect(
      framed.filter((url) => url.startsWith(`${TEST_ORIGIN}/embed/`)),
    ).toEqual([`${TEST_ORIGIN}/embed/@owner/talk`])
    // Chromium and Firefox put their own error page in the refused frame;
    // WebKit keeps the address on an empty document. Either way, nothing
    // the service answered is in it.
    for (const frame of page.frames()) {
      if (!frame.url().startsWith(`${TEST_ORIGIN}/@`)) continue
      const shown = await frame.content()
      expect(shown).not.toContain('<script')
      expect(shown).not.toContain('<iframe')
    }
    // Nothing of the service reached the page around it.
    expect(
      await page.evaluate(
        () => (window as unknown as { heard: string[] }).heard,
      ),
    ).toEqual([])
  })
}, 30000)

test('F25-AC4: Given slides that try to move the page around the embed, open a tab, download and send a form, When a reader opens the page and then clicks in the slides, Then none of it goes through', async () => {
  await withArticle(code(), async (page, observed, context) => {
    const deck = deckIn(page)
    const attempted = () => deck.locator('body').getAttribute('data-attempted')
    await expect.poll(attempted).toBe('load')
    await deck.locator('#page').click()
    await expect.poll(attempted).toBe('click')
    // A navigation, popup, download or submit set off by then shows up.
    await page.waitForTimeout(1000)
    expect(page.url()).toBe(`${BLOG}/post`)
    expect(context.pages()).toHaveLength(1)
    expect(observed.downloads).toEqual([])
    expect(
      observed.requests.filter((url) => /elsewhere|\/submit/.test(url)),
    ).toEqual([])
    expect(page.frames().map((frame) => frame.url())).toContain(
      `${TEST_ORIGIN}/embed/@owner/talk`,
    )
    // The slides are still there, and still turn.
    await deck.locator('#next').click()
    await expect.poll(() => deck.locator('#page').textContent()).toBe('2')
  })
}, 30000)

test.each([
  ['the share URL of other slides', '#other'],
  ['another site', '#outside'],
])(
  'F25-AC4: Given embedded slides on page 2 with a link to %s, When the reader presses it, Then nothing leaves the frame, and the slides are still there to read: untouched, or loaded again from their first page where the browser had replaced them',
  async (_, link) => {
    await withArticle(code(), async (page, observed, context) => {
      const deck = deckIn(page)
      await expect.poll(() => deck.locator('#page').textContent()).toBe('1')
      await deck.locator('#next').click()
      await expect.poll(() => deck.locator('#page').textContent()).toBe('2')
      const asked = observed.requests.length

      await deck.locator(link).click()

      // Chromium puts its error page in the frame, and the embed loads the
      // slides again. Firefox leaves the slides where they were. WebKit
      // leaves them too, but reports a load of the frame as Chromium does,
      // so there the slides are loaded again as well.
      const kept = engineName === 'firefox' ? '2' : '1'
      await page.waitForTimeout(1000)
      await expect
        .poll(() => deck.locator('#page').textContent(), { timeout: 10000 })
        .toBe(kept)
      await deck.locator('#next').click()
      await expect
        .poll(() => deck.locator('#page').textContent())
        .toBe(String(Number(kept) + 1))
      // The move was refused before anything was asked of the service or
      // of the other site, and the article stayed.
      const later = observed.requests.slice(asked)
      expect(
        later.filter((url) => /elsewhere|\/@owner\/other/.test(url)),
      ).toEqual([])
      expect(page.url()).toBe(`${BLOG}/post`)
      expect(context.pages()).toHaveLength(1)
    })
  },
  30000,
)

test('F25-AC1: Given embedded slides made of several files, When the reader follows a link to another of their files, Then the frame shows it and is not sent back to the first page', async () => {
  await withArticle(code(), async (page) => {
    const deck = deckIn(page)
    await expect.poll(() => deck.locator('#page').textContent()).toBe('1')
    await deck.locator('#inside').click()
    await expect.poll(() => deck.locator('#more').textContent()).toBe('more')
    await page.waitForTimeout(2500)
    expect(await deck.locator('#more').count()).toBe(1)
  })
}, 30000)
