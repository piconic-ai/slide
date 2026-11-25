import { openTestBrowser } from '../test-open-browser'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Frame,
  type Page,
  type Route,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { scriptHashSource } from '../pages/script'
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

/**
 * The author's own script: it wraps history.pushState itself, as some
 * slide tools do, and turns pages both ways a tool may.
 */
const AUTHOR_SCRIPT = `
const own = history.pushState
let wrapped = 0
history.pushState = function (...args) {
  wrapped++
  return own.apply(this, args)
}
addEventListener('DOMContentLoaded', () => {
  const said = document.querySelector('#said')
  said.textContent = 'ready'
  document.querySelector('#push').addEventListener('click', () => {
    history.pushState(null, '', '#2')
    said.textContent = 'pushed ' + wrapped
  })
  document.querySelector('#hash').addEventListener('click', () => {
    location.hash = '#4'
  })
})
`
// The slides' buttons are pressed by an event in the frame: a click by its
// position may land while the viewer still lays the frame out.
// Japanese text shows the page is still read as UTF-8 with the script
// before its charset declaration.
const BODY = `<body><h1 id="title">発表のスライド</h1><p id="said"></p><button id="push">2</button><button id="hash">3</button></body>`

const policy = (content: string) =>
  `<meta http-equiv="Content-Security-Policy" content="${content}">`

/** Slides of one page and their files, by the policy they declare. */
async function decks(): Promise<Record<string, Record<string, string>>> {
  const authorHash = await scriptHashSource(AUTHOR_SCRIPT)
  const inline = `<script>${AUTHOR_SCRIPT}</script>`
  const page = (head: string) =>
    `<!doctype html><html><head><meta charset="utf-8">${head}<title>t</title></head>${BODY}</html>`
  return {
    // The policy of the slides that showed the problem (sanpo).
    unsafe: {
      'index.html': page(
        policy(
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
        ) + inline,
      ),
    },
    self: {
      'index.html': page(
        policy("script-src 'self'") + '<script src="/deck.js"></script>',
      ),
      'deck.js': AUTHOR_SCRIPT,
    },
    hashed: { 'index.html': page(policy(`script-src ${authorHash}`) + inline) },
    // A nonce and strict-dynamic: neither the page script's hash nor
    // 'unsafe-inline' would let it run after this policy.
    nonce: {
      'index.html': page(
        policy(
          "default-src 'none'; script-src 'nonce-n0nce' 'strict-dynamic'",
        ) + `<script nonce="n0nce">${AUTHOR_SCRIPT}</script>`,
      ),
    },
    open: { 'index.html': page(inline) },
    // Loads the page script from its file too, and has no policy.
    loading: {
      'index.html': page('<script src="/_preview/pages.js"></script>' + inline),
    },
    // An inline script its own policy refuses: violations are seen.
    refused: {
      'index.html': page(policy("script-src 'self'") + '<script>1</script>'),
    },
  }
}

/** Stores a version's files, as a finished upload would. */
async function store(id: string, files: Record<string, string>) {
  for (const [index, [path, body]] of Object.entries(files).entries()) {
    const key = `${id}/${index}/lease`
    await platform.env.UPLOADS.put(key, body)
    await orm.insert(uploadFiles).values({
      deployment_id: id,
      id: String(index),
      path,
      size: body.length,
      sha256: String(index).padStart(64, 'a'),
      media_type: path.endsWith('.js')
        ? 'text/javascript'
        : 'text/html; charset=utf-8',
      object_key: key,
    })
  }
}

let browser: Browser
beforeAll(async () => {
  await applyMigrations(db)
  // The author's account, whose handle the share URLs name.
  await signIn(env)
  for (const [index, [slug, files]] of Object.entries(await decks()).entries())
    await store(await seedPublic(db, slug, index + 1, slug), files)
  browser = await openTestBrowser(engine)
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

const isServed = (url: URL) =>
  url.hostname === 'slide.example' || url.hostname.endsWith('.content.example')

/** Answers browser requests with the Worker, as Cloudflare would. */
async function serve(route: Route) {
  const request = route.request()
  const url = new URL(request.url())
  if (!isServed(url)) return route.abort()
  const headers = await request.allHeaders()
  // Chromium adds Sec-Fetch-Dest after interception; the frame's
  // navigation is given the value it sends on the network.
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

// Records the policy violations of every document, before its own scripts.
const WATCH_VIOLATIONS = `
window.__violations = []
document.addEventListener('securitypolicyviolation', (event) =>
  window.__violations.push(event.violatedDirective + ' ' + event.blockedURI),
)`

async function withPage(use: (page: Page, logged: string[]) => Promise<void>) {
  const context: BrowserContext = await browser.newContext()
  try {
    await context.addInitScript(WATCH_VIOLATIONS)
    await context.route('**/*', serve)
    const page = await context.newPage()
    const logged: string[] = []
    page.on('console', (message) => logged.push(message.text()))
    await use(page, logged)
  } finally {
    await context.close()
  }
}

/** The slides' frame, once it has loaded. */
async function deckFrame(page: Page): Promise<Frame> {
  await expect
    .poll(() =>
      page.frames().find((frame) => frame.url().includes('.content.example')),
    )
    .toBeDefined()
  return page
    .frames()
    .find((frame) => frame.url().includes('.content.example'))!
}

/**
 * Opens the slides at their page 3 and waits until the viewer has heard
 * of it from them: the viewer is then listening, and its frame in place.
 */
async function openAtThree(page: Page, slug: string) {
  await page.goto(`${TEST_ORIGIN}/@owner/${slug}/3`)
  const frame = await deckFrame(page)
  const deck = page.frameLocator('iframe#deck')
  await expect.poll(() => deck.locator('#said').textContent()).toBe('ready')
  await expect
    .poll(() => page.locator('#share-page-url').inputValue())
    .toBe(`${TEST_ORIGIN}/@owner/${slug}/3`)
  return { frame, deck }
}

const violations = (frame: Frame) =>
  frame.evaluate(
    () => (window as unknown as { __violations: string[] }).__violations,
  )

const CSP_MESSAGE = /Content.Security.Policy|Refused to/i

test.each([
  ["default-src 'none'; script-src 'unsafe-inline'", 'unsafe'],
  ["script-src 'self'", 'self'],
  ["script-src 'sha256-…'", 'hashed'],
  ["script-src 'nonce-…' 'strict-dynamic'", 'nonce'],
  ['no policy', 'open'],
])(
  'F03-AC143, F03-AC145, F03-AC151: Given slides with %s, When the reader turns pages in the viewer, Then the address follows, the author’s script keeps working, and no policy is violated',
  async (_, slug) => {
    await withPage(async (page, logged) => {
      const { frame, deck } = await openAtThree(page, slug)
      expect(await deck.locator('#title').textContent()).toBe('発表のスライド')
      await deck.locator('#push').dispatchEvent('click')
      await page.waitForURL((url) => url.pathname === `/@owner/${slug}/2`)
      // The author's wrapper ran too: it sits around the page script's.
      expect(await deck.locator('#said').textContent()).toBe('pushed 1')
      await deck.locator('#hash').dispatchEvent('click')
      await page.waitForURL((url) => url.pathname === `/@owner/${slug}/4`)
      expect(await violations(frame)).toEqual([])
      expect(logged.filter((text) => CSP_MESSAGE.test(text))).toEqual([])
    })
  },
  30000,
)

test('F03-AC145: Given slides whose policy refuses an inline script of theirs, When they are opened, Then the violation is seen, as the checks above rely on', async () => {
  await withPage(async (page) => {
    await page.goto(`${TEST_ORIGIN}/@owner/refused`)
    const frame = await deckFrame(page)
    await expect.poll(() => violations(frame)).not.toEqual([])
  })
}, 30000)

test('F03-AC146: Given slides that load the page script from its file as well, When the reader turns a page, Then the viewer is told of it once', async () => {
  await withPage(async (page) => {
    const { deck } = await openAtThree(page, 'loading')
    await page.evaluate(() => {
      const told: number[] = []
      ;(window as unknown as { told: number[] }).told = told
      addEventListener('message', (event) => {
        if (event.data?.type === 'slide:page') told.push(event.data.page)
      })
    })
    await deck.locator('#push').dispatchEvent('click')
    await page.waitForURL((url) => url.pathname === '/@owner/loading/2')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(
      await page.evaluate(() => (window as unknown as { told: number[] }).told),
    ).toEqual([2])
  })
}, 30000)
