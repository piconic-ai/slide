import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  chromium,
  devices,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Route,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

/**
 * The browser engine, chosen with BROWSER (chromium, webkit or firefox). CI
 * installs Chromium only; the other engines are run locally.
 */
const engineName = process.env.BROWSER ?? 'chromium'
const engine = { chromium, webkit, firefox }[engineName]
if (!engine) throw new Error(`Unknown BROWSER: ${engineName}`)

/**
 * How each engine words a service worker registration that CSP refused.
 * Without `worker-src 'none'`, WebKit registers it and Firefox fails later
 * during installation, so these messages show the CSP refused it.
 */
const CSP_WORKER_REFUSAL: Record<string, RegExp> = {
  chromium: /Content Security Policy/,
  firefox: /not allowed by policy/,
  webkit: /The operation is insecure/,
}

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

/** Author files of the deck, as a static site generator would emit them. */
const DECK: Record<string, [string, string]> = {
  'index.html': [
    'text/html; charset=utf-8',
    `<!doctype html><html><head>
    <link rel="stylesheet" href="/css/site.css">
    <script type="module" src="./js/main.js"></script>
    <script src="/js/probe.js"></script>
    </head><body>
    <h1 id="title">Deck</h1>
    <img id="relative" src="img/dot.svg"><img id="root" src="/img/dot.svg">
    <p id="module"></p><p id="probes"></p>
    <a id="next" href="/next/">next</a>
    <form id="form" action="/submit" method="post"><button>send</button></form>
    </body></html>`,
  ],
  'css/site.css': ['text/css', 'h1 { color: rgb(1, 2, 3); }'],
  'img/dot.svg': [
    'image/svg+xml',
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>',
  ],
  'js/util.js': ['text/javascript', 'export const answer = "module ok"'],
  'js/main.js': [
    'text/javascript',
    `import { answer } from './util.js'
    document.querySelector('#module').textContent = answer`,
  ],
  // Tries what a hostile deck would try. Whether each attempt went through
  // is judged from outside: requests, pages, and the error it got.
  'js/probe.js': [
    'text/javascript',
    `document.addEventListener('click', () => {
      // A navigation after the reader's click has user activation.
      try { top.location.href = 'https://elsewhere.example/activated' } catch {}
    })
    addEventListener('load', async () => {
      const results = {}
      if (window !== top) {
        try { top.location.href = 'https://elsewhere.example/top' } catch {}
      }
      try { window.open('https://elsewhere.example/popup') } catch {}
      results.worker = navigator.serviceWorker
        ? await navigator.serviceWorker.register('/sw.js').then(
            () => 'registered',
            (error) => String(error && error.message),
          )
        : 'unavailable'
      await fetch('${TEST_ORIGIN}/api/decks', { credentials: 'include' }).catch(() => {})
      document.querySelector('#probes').textContent = JSON.stringify(results)
      try { document.querySelector('#form').requestSubmit() } catch {}
    })`,
  ],
  'sw.js': ['text/javascript', 'self.addEventListener("fetch", () => {})'],
  'next/index.html': ['text/html', '<p id="index">directory index</p>'],
}

let browser: Browser
let deploymentId = ''
let ownerCookie = ''

beforeAll(async () => {
  await applyMigrations(db)
  await resetTables(db)
  await seedDeck(db, 'talk')
  ownerCookie = await signIn(env)
  deploymentId = await seedDeployment(db, 'talk')
  for (const [index, [path, [type, body]]] of Object.entries(DECK).entries()) {
    const key = `${deploymentId}/${index}/lease`
    await platform.env.UPLOADS.put(key, body)
    const digest = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)),
    ).toString('hex')
    await orm.insert(uploadFiles).values({
      deployment_id: deploymentId,
      id: String(index),
      path,
      size: body.length,
      sha256: digest,
      media_type: type,
      object_key: key,
    })
  }
  const published = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/decks/talk/publication`, {
      method: 'POST',
      headers: {
        Cookie: ownerCookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'publish',
        deploymentId,
        expectedRevision: 0,
      }),
    }),
    env,
  )
  expect(published.status).toBe(200)
  browser = await engine.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

type Observed = {
  /** Every request any page or frame of the context made. */
  requests: string[]
  /** Management API requests made from author content, with the answers. */
  apiCalls: {
    cookie: string | null
    status: number
    allowOrigin: string | null
  }[]
}

type Serving = Readonly<{
  /** Drops the CSP sandbox from author files, leaving the iframe's alone. */
  withoutContentSandbox?: boolean
  /** Drops the viewer's iframe sandbox, leaving the content CSP alone. */
  withoutFrameSandbox?: boolean
}>

const isServed = (url: URL) =>
  url.hostname === 'slide.example' || url.hostname.endsWith('.content.example')

/** Answers browser requests with the Worker, as Cloudflare would. */
function serve(observed: Observed, serving: Serving) {
  return async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!isServed(url)) return route.abort()
    const body = request.postDataBuffer()
    const response = await server.fetch(
      new Request(url, {
        method: request.method(),
        headers: await request.allHeaders(),
        body:
          body && request.method() !== 'GET' ? new Uint8Array(body) : undefined,
        redirect: 'manual',
      }),
      env,
    )
    const headers = Object.fromEntries(response.headers)
    const policy = headers['content-security-policy']
    if (serving.withoutContentSandbox && policy)
      headers['content-security-policy'] = policy.replace(
        /sandbox[^;]*;\s*/,
        '',
      )
    if (url.hostname === 'slide.example' && url.pathname.startsWith('/api/'))
      observed.apiCalls.push({
        cookie: (await request.allHeaders()).cookie ?? null,
        status: response.status,
        allowOrigin: response.headers.get('Access-Control-Allow-Origin'),
      })
    let bytes = Buffer.from(await response.arrayBuffer())
    if (serving.withoutFrameSandbox && url.pathname.startsWith('/@'))
      bytes = Buffer.from(bytes.toString().replace(/sandbox="[^"]*"/, ''))
    await route.fulfill({ status: response.status, headers, body: bytes })
  }
}

/** Runs `use` on a fresh context whose owner is signed in on the service. */
async function withContext(
  options: BrowserContextOptions & { serving?: Serving },
  use: (context: BrowserContext, observed: Observed) => Promise<void>,
) {
  const { serving = {}, ...contextOptions } = options
  const context = await browser.newContext(contextOptions)
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
    const observed: Observed = { requests: [], apiCalls: [] }
    context.on('request', (request) => observed.requests.push(request.url()))
    await context.route('**/*', serve(observed, serving))
    await use(context, observed)
  } finally {
    await context.close()
  }
}

/**
 * Waits for the deck's probes, then for anything they set off late, and
 * checks that none of the attempts went through.
 */
async function expectContained(
  context: BrowserContext,
  observed: Observed,
  probes: () => Promise<string | null>,
) {
  await expect.poll(probes).not.toBe('')
  const results = JSON.parse((await probes()) ?? '{}')
  // A submit, navigation or popup the probes set off shows up by then.
  await new Promise((resolve) => setTimeout(resolve, 1000))
  expect(context.pages()).toHaveLength(1)
  expect(
    observed.requests.filter((url) => /elsewhere|\/submit/.test(url)),
  ).toEqual([])
  // Playwright's fulfilled responses skip the browser's CORS check, so the
  // request is checked instead: no owner cookie, refused, no CORS grant.
  expect(observed.apiCalls).not.toHaveLength(0)
  for (const call of observed.apiCalls) {
    expect(call.cookie).toBeNull()
    expect(call.status).toBeGreaterThanOrEqual(400)
    expect(call.allowOrigin).toBeNull()
  }
  expect(results.worker).toMatch(CSP_WORKER_REFUSAL[engineName])
}

test('Given a published deck, When a reader opens its share URL, Then module, relative and root-relative files load and the frame has focus', async () => {
  await withContext({}, async (context) => {
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/talk`)
    const frame = page.frameLocator('iframe')
    await expect
      .poll(() => frame.locator('#module').textContent())
      .toBe('module ok')
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
      'IFRAME',
    )
    expect(
      await frame.locator('#title').evaluate((h) => getComputedStyle(h).color),
    ).toBe('rgb(1, 2, 3)')
    for (const id of ['#relative', '#root'])
      expect(
        await frame
          .locator(id)
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      ).toBe(4)
    await frame.locator('#next').click()
    await expect
      .poll(() => frame.locator('#index').textContent())
      .toBe('directory index')
  })
}, 20000)

test.each([
  ['both the iframe sandbox and the content CSP', {}],
  ['the iframe sandbox alone', { withoutContentSandbox: true }],
  ['the content CSP alone', { withoutFrameSandbox: true }],
])(
  'Given %s, When author JS in the viewer tries top navigation (also after a click), popups, forms, service workers and the management API, Then none goes through',
  async (_, serving) => {
    await withContext({ serving }, async (context, observed) => {
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/@owner/talk`)
      const frame = page.frameLocator('iframe')
      const probes = () => frame.locator('#probes').textContent()
      await expect.poll(probes).not.toBe('')
      await frame.locator('#title').click()
      await expectContained(context, observed, probes)
      expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/talk`)
    })
  },
  20000,
)

test('Given the content CSP alone, When the deck is opened at the top level of its origin, Then popups, forms and service workers are refused', async () => {
  await withContext({}, async (context, observed) => {
    const page = await context.newPage()
    await page.goto(`https://d-${deploymentId}.content.example/`)
    await expectContained(context, observed, () =>
      page.locator('#probes').textContent(),
    )
  })
}, 20000)

// The language is chosen in the URL: engines differ in the Accept-Language
// they send (Firefox asks for en-US), and the labels depend on it.
test.each([
  ['ja', 'リンクをコピー', 'コピーしました'],
  ['en', 'Copy link', 'Copied'],
])(
  'Given a phone-sized browser on the %s page, When the share URL is opened, Then the deck fills the width without horizontal scrolling and the link can be copied',
  async (lang, copy, copied) => {
    // Phone emulation is WebKit's own on webkit; Firefox has no mobile mode.
    const { defaultBrowserType: _, ...phone } =
      engineName === 'webkit' ? devices['iPhone 13'] : devices['Pixel 7']
    const options = {
      ...(engineName === 'firefox'
        ? { viewport: { width: 390, height: 844 } }
        : engineName === 'chromium'
          ? { ...phone, permissions: ['clipboard-read', 'clipboard-write'] }
          : phone),
    }
    await withContext(options, async (context) => {
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/@owner/talk?lang=${lang}`)
      await expect
        .poll(() =>
          page.frameLocator('iframe').locator('#module').textContent(),
        )
        .toBe('module ok')
      const layout = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: window.innerWidth,
        frame: document.querySelector('iframe')?.getBoundingClientRect().width,
      }))
      expect(layout.scroll).toBeLessThanOrEqual(layout.width)
      expect(layout.frame).toBe(layout.width)
      await page.getByRole('button', { name: copy }).click()
      await expect
        .poll(() => page.getByRole('button', { name: copied }).count())
        .toBe(1)
    })
  },
  20000,
)
