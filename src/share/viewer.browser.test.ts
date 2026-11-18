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
  type Page,
  type Request as PlaywrightRequest,
  type Route,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import {
  accounts,
  citations,
  communities,
  events,
  eventTalks,
  mutes,
  reactionPosts,
  uploadFiles,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
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
    <a id="cite" href="${TEST_ORIGIN}/@owner/talk/3">cite</a>
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
      // The page around the deck belongs to another origin.
      try {
        results.parent = window === top ? 'top' : 'read:' + top.document.title
      } catch { results.parent = 'refused' }
      // The reader's session on the service is not this origin's to see.
      results.cookie = document.cookie
      // At the top level a refused download replaces the page with the
      // browser's error page, so it is tried only inside the viewer.
      if (window !== top) try {
        const link = document.createElement('a')
        link.href = '/img/dot.svg'
        link.download = 'dot.svg'
        document.body.append(link)
        link.click()
      } catch {}
      results.worker = navigator.serviceWorker
        ? await navigator.serviceWorker.register('/sw.js').then(
            () => 'registered',
            (error) => String(error && error.message),
          )
        : 'unavailable'
      await fetch('${TEST_ORIGIN}/api/slides', { credentials: 'include' }).catch(() => {})
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

/** Stores author files as a finished upload of the deployment would. */
async function putFiles(id: string, files: Record<string, [string, string]>) {
  for (const [index, [path, [type, body]]] of Object.entries(files).entries()) {
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
}

/** A public deck made of one page. */
async function seedPage(deck: string, readyAt: number, body: string) {
  const id = await seedPublic(db, deck, readyAt, deck)
  await putFiles(id, { 'index.html': ['text/html; charset=utf-8', body] })
  return id
}

beforeAll(async () => {
  await applyMigrations(db)
  await resetTables(db)
  await seedDeck(db, 'talk')
  ownerCookie = await signIn(env)
  deploymentId = await seedDeployment(db, 'talk')
  await putFiles(deploymentId, DECK)
  // A deck that cites another and, once loaded, sends its own frame to a
  // share URL without the reader asking.
  await seedPage('cited', 1, '<h1 id="title">Cited</h1>')
  const pushing = await seedPage(
    'pushing',
    2,
    `<a href="${TEST_ORIGIN}/@owner/cited">cited</a>
    <script>
      addEventListener('load', () =>
        setTimeout(() => (location.href = '${TEST_ORIGIN}/@owner/talk/9'), 100),
      )
    </script>`,
  )
  await orm.insert(citations).values({
    deployment_id: pushing,
    target_handle: 'owner',
    target_slug: 'cited',
    target_page: 0,
  })
  const published = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides/talk/publication`, {
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
  /** Files any page of the context started to download. */
  downloads: string[]
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
  /** Holds the viewer's script back until the deck has loaded. */
  lateScript?: boolean
}>

const isServed = (url: URL) =>
  url.hostname === 'slide.example' || url.hostname.endsWith('.content.example')

function isConfirmationPost(request: PlaywrightRequest) {
  return (
    request.method() === 'POST' &&
    request.isNavigationRequest() &&
    [`${TEST_ORIGIN}/mutes`, `${TEST_ORIGIN}/follows`].includes(request.url())
  )
}

/**
 * The headers the Worker would receive. Chromium adds Sec-Fetch-Dest after
 * interception, so a navigation of a nested frame is given the value it
 * sends on the network; Firefox and WebKit report it themselves.
 */
async function forwardedHeaders(request: PlaywrightRequest) {
  const headers = await request.allHeaders()
  // Chromium also adds Sec-Fetch-Site after interception. For a POST from
  // the service to itself, forward the same value it sends on the network.
  if (
    request.method() === 'POST' &&
    new URL(request.url()).origin === TEST_ORIGIN &&
    !headers['sec-fetch-site'] &&
    new URL(request.frame().url()).origin === TEST_ORIGIN
  )
    headers['sec-fetch-site'] = 'same-origin'
  return 'sec-fetch-dest' in headers ||
    !request.isNavigationRequest() ||
    !request.frame().parentFrame()
    ? headers
    : { ...headers, 'sec-fetch-dest': 'iframe' }
}

async function fulfill(
  route: Route,
  status: number,
  headers: Record<string, string>,
  body: Buffer,
) {
  // Playwright does not intercept the next request of an HTTP redirect.
  // Refresh navigates to the Worker's Location with a fresh GET.
  const request = route.request()
  if (
    isConfirmationPost(request) &&
    status === 303 &&
    headers.location &&
    new URL(headers.location, TEST_ORIGIN).origin === TEST_ORIGIN
  )
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { Refresh: `0; url=${headers.location}` },
      body: '',
    })
  return route.fulfill({ status, headers, body })
}

/** Answers browser requests with the Worker, as Cloudflare would. */
function serve(observed: Observed, serving: Serving) {
  return async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!isServed(url)) return route.abort()
    if (serving.lateScript && url.pathname === '/share.js')
      await new Promise((resolve) => setTimeout(resolve, 1200))
    const body = request.postDataBuffer()
    const response = await server.fetch(
      new Request(url, {
        method: request.method(),
        headers: {
          ...(await forwardedHeaders(request)),
          // On the network a body comes with its size; Playwright's list
          // of headers leaves it out.
          ...(body ? { 'content-length': String(body.length) } : {}),
        },
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
    await fulfill(route, response.status, headers, bytes)
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
    const observed: Observed = { requests: [], downloads: [], apiCalls: [] }
    context.on('request', (request) => observed.requests.push(request.url()))
    context.on('page', (page) =>
      page.on('download', (download) =>
        observed.downloads.push(download.suggestedFilename()),
      ),
    )
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
  expect(observed.downloads).toEqual([])
  expect(
    observed.requests.filter((url) => /elsewhere|\/submit/.test(url)),
  ).toEqual([])
  expect(results.parent).toMatch(/^(refused|top)$/)
  expect(results.cookie).not.toContain('slide_owner')
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

test('F17-AC4: Given a published deck whose script tries what the sandbox refuses, When a reader opens its share URL, Then module, relative and root-relative files still load and the frame has focus', async () => {
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

test('Given slides that load an image and call an API on other hosts, When a reader opens them, Then the requests leave and the viewer says nothing about them', async () => {
  const id = await seedPublic(db, 'reaching', 3, 'Reaching')
  await putFiles(id, {
    'index.html': [
      'text/html; charset=utf-8',
      `<!doctype html><img id="own" src="img/dot.svg">
      <img src="https://images.elsewhere.example/a.png">
      <script>fetch('https://api.elsewhere.example/v1').catch(() => {})</script>`,
    ],
    'img/dot.svg': DECK['img/dot.svg']!,
  })
  await withContext({}, async (context, observed) => {
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/reaching`)
    const frame = page.frameLocator('iframe#deck')
    await expect
      .poll(() =>
        frame
          .locator('#own')
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(4)
    // Slides may talk to other hosts: the requests leave the page, and this
    // test's network is what drops them.
    await expect
      .poll(() => observed.requests)
      .toEqual(
        expect.arrayContaining([
          'https://images.elsewhere.example/a.png',
          'https://api.elsewhere.example/v1',
        ]),
      )
    // The viewer lists nothing about them.
    expect(await page.locator('details.safety').count()).toBe(0)
  })
}, 30000)

test('Given a deck linking to a share URL, When a reader follows the link, Then the viewer opens that page and going back returns to the deck', async () => {
  await withContext({}, async (context) => {
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/talk`)
    await page.frameLocator('iframe').locator('#cite').click()
    await page.waitForURL(`${TEST_ORIGIN}/@owner/talk/3`)
    await expect
      .poll(() => page.frameLocator('iframe').locator('#title').textContent())
      .toBe('Deck')
    await page.goBack()
    await expect
      .poll(() => page.frameLocator('iframe').locator('#title').textContent())
      .toBe('Deck')
    // Returning must not follow the link again.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/talk`)
  })
}, 20000)

test('Given the viewer’s script starts after the deck has loaded, When a reader follows a link in the deck, Then the first click opens that page', async () => {
  await withContext({ serving: { lateScript: true } }, async (context) => {
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/talk`)
    await page.frameLocator('iframe').locator('#cite').click()
    await page.waitForURL(`${TEST_ORIGIN}/@owner/talk/3`, { timeout: 5000 })
  })
}, 20000)

test('Given a deck that asks the viewer to open a path itself, When the viewer hears it, Then the viewer stays where it is', async () => {
  await withContext({}, async (context) => {
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/talk`)
    const title = page.frameLocator('iframe').locator('#title')
    await expect.poll(() => title.textContent()).toBe('Deck')
    await title.evaluate(() => {
      for (const path of ['/@owner/talk/9', 'https://elsewhere.example/'])
        parent.postMessage({ type: 'slide:open', path }, '*')
    })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/talk`)
  })
}, 20000)

test('Given a citing deck shown small that sends its frame to a share URL, When a reader opens the cited deck, Then the viewer stays where it is', async () => {
  await withContext({}, async (context, observed) => {
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/cited`)
    await page.locator('[data-mini] iframe').scrollIntoViewIfNeeded()
    await expect
      .poll(() => observed.requests)
      .toContain(`${TEST_ORIGIN}/@owner/talk/9`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/cited`)
    // The deck is put back when the page shows and once on its request,
    // and is not loaded again after that.
    expect(
      observed.requests.filter((url) => url.endsWith('/@owner/talk/9')).length,
    ).toBeLessThanOrEqual(3)
  })
}, 20000)

test.each([
  ['both the iframe sandbox and the content CSP', {}],
  ['the iframe sandbox alone', { withoutContentSandbox: true }],
  ['the content CSP alone', { withoutFrameSandbox: true }],
])(
  'F17-AC1, F17-AC2: Given %s, When author JS in the viewer tries top navigation (also after a click), popups, downloads, forms, service workers, the page around it and the management API, Then none goes through',
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

test('F17-AC1, F17-AC2: Given the content CSP alone, When the deck is opened at the top level of its origin, Then popups, forms and service workers are refused', async () => {
  await withContext({}, async (context, observed) => {
    const page = await context.newPage()
    await page.goto(`https://d-${deploymentId}.content.example/`)
    await expectContained(context, observed, () =>
      page.locator('#probes').textContent(),
    )
  })
}, 20000)

test('Given a deck with a post on a 320px screen, When opened, Then the post’s frame is as wide as an embed needs', async () => {
  await orm.insert(reactionPosts).values({
    id: 'narrow',
    deck_id: 'cited',
    page: 0,
    service: 'bluesky',
    post_key: 'did:plc:z72i7hdynmk6r22z27h6tvur/3l6oveex3ii2l',
    source: 'pasted',
    posted_at: null,
    created_at: 1,
  })
  await withContext(
    { viewport: { width: 320, height: 640 } },
    async (context) => {
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/@owner/cited`)
      const layout = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: window.innerWidth,
        embed: document
          .querySelector('iframe[data-embed]')
          ?.getBoundingClientRect().width,
      }))
      // Bluesky's embed lays itself out at 300px or more.
      expect(layout.embed).toBeGreaterThanOrEqual(300)
      expect(layout.scroll).toBeLessThanOrEqual(layout.width)
    },
  )
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

test('Given slides that tell their page, When the reader turns pages, Then the address and the URL to copy follow, and pages no slide can have are ignored', async () => {
  await seedPage(
    'paged',
    4,
    `<!doctype html><script src="/_preview/pages.js"></script>
    <button id="hash" onclick="location.hash = '#3'">3</button>
    <button id="state" onclick="history.replaceState(null, '', '#5')">5</button>
    <button id="first" onclick="history.pushState(null, '', '#1')">1</button>
    <button id="other" onclick="location.hash = '#notes'">notes</button>
    <button id="deep" onclick="location.hash = '#6/2'">6/2</button>
    <button id="forged" onclick="
      for (const page of [0, 10000, 2.5, '7', null])
        parent.postMessage({ type: 'slide:page', page }, '*')
      parent.postMessage({ type: 'slide:other', page: 8 }, '*')
    ">forged</button>`,
  )
  await withContext({}, async (context) => {
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/paged/2?lang=en`)
    const frame = page.frameLocator('iframe#deck')
    const shown = async () => [
      new URL(page.url()).pathname + new URL(page.url()).search,
      await page.locator('#share-url').inputValue(),
    ]
    // The viewer handed the slides #2, and the slides say so themselves.
    await expect
      .poll(shown)
      .toEqual(['/@owner/paged/2?lang=en', `${TEST_ORIGIN}/@owner/paged/2`])
    await frame.locator('#hash').click()
    await expect
      .poll(shown)
      .toEqual(['/@owner/paged/3?lang=en', `${TEST_ORIGIN}/@owner/paged/3`])
    await frame.locator('#state').click()
    await expect
      .poll(shown)
      .toEqual(['/@owner/paged/5?lang=en', `${TEST_ORIGIN}/@owner/paged/5`])
    // A fragment that is not a page number, and pages no slides have.
    for (const button of ['#other', '#deep', '#forged'])
      await frame.locator(button).click()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(await shown()).toEqual([
      '/@owner/paged/5?lang=en',
      `${TEST_ORIGIN}/@owner/paged/5`,
    ])
    await frame.locator('#first').click()
    await expect
      .poll(shown)
      .toEqual(['/@owner/paged?lang=en', `${TEST_ORIGIN}/@owner/paged`])
  })
}, 30000)

test('Given a viewer whose script loads late, When the reader turns a page meanwhile, Then the address follows once the script is listening', async () => {
  await withContext({ serving: { lateScript: true } }, async (context) => {
    const page = await context.newPage()
    const scriptLoaded = page.waitForResponse((response) =>
      response.url().endsWith('/share.js'),
    )
    // The deferred script holds DOMContentLoaded back, so the page is not
    // waited for: the slides are turned while the script is on its way.
    await page.goto(`${TEST_ORIGIN}/@owner/paged/2`, { waitUntil: 'commit' })
    let listening = false
    void scriptLoaded.then(() => (listening = true))
    await page.frameLocator('iframe#deck').locator('#hash').click()
    expect(listening).toBe(false)
    await scriptLoaded
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe('/@owner/paged/3')
    expect(await page.locator('#share-url').inputValue()).toBe(
      `${TEST_ORIGIN}/@owner/paged/3`,
    )
  })
}, 30000)

test('Given slides shown small under another, When they tell a page, Then the viewer of the other slides does not follow', async () => {
  // `pushing` cites `cited`, so the viewer of `cited` frames `pushing` below.
  await withContext({}, async (context) => {
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/cited`)
    await page.locator('iframe[data-deck]:not(#deck)').first().waitFor()
    const main = await (
      await page.locator('iframe#deck').elementHandle()
    )?.contentFrame()
    const others = page
      .frames()
      .filter((frame) => frame !== page.mainFrame() && frame !== main)
    // A frame that is between documents cannot be reached; one must be.
    const posted = await Promise.all(
      others.map((frame) =>
        frame
          .evaluate(() =>
            parent.postMessage({ type: 'slide:page', page: 4 }, '*'),
          )
          .then(
            () => true,
            () => false,
          ),
      ),
    )
    expect(posted).toContain(true)
    await new Promise((resolve) => setTimeout(resolve, 300))
    // Only the frame of the slides the page is about is heard.
    expect(new URL(page.url()).pathname).toBe('/@owner/cited')
  })
}, 30000)

test.each([
  ['a desktop browser', {}],
  ['a phone-sized browser', { viewport: { width: 390, height: 844 } }],
])(
  'F17-AC16: Given %s, When the reader opens the menu beside the title, Then “report” appears inside the page and leads to the report page for this deck',
  async (_, options) => {
    await withContext(options, async (context) => {
      const page = await context.newPage()
      // The language is chosen in the URL: engines differ in what they ask for.
      await page.goto(`${TEST_ORIGIN}/@owner/talk?lang=ja`)
      const report = page.getByRole('link', { name: '通報する' })
      await expect.poll(() => report.isVisible()).toBe(false)

      await page.locator('details.deck-menu > summary').click()
      await expect.poll(() => report.isVisible()).toBe(true)
      // The title and the author under it start at the same edge.
      const left = (selector: string) =>
        page
          .locator(selector)
          .evaluate((element) => element.getBoundingClientRect().left)
      expect(await left('.stage .author')).toBe(await left('.stage h1'))
      const box = await report.boundingBox()
      const width = page.viewportSize()?.width ?? 0
      expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      ).toBeLessThanOrEqual(0)

      await report.click()
      await page.waitForURL(/\/reports\/new\?slide=/)
      expect(new URL(page.url()).searchParams.get('slide')).toBe('/@owner/talk')
    })
  },
  20000,
)

async function withReaderOnPageThree(
  userId: string,
  handle: string,
  use: (page: Page, slide: string) => Promise<void>,
) {
  await orm.insert(accounts).values({ user_id: userId, handle, created_at: 1 })
  const id = await seedPublic(
    db,
    `workshop-${handle}`,
    4,
    'Workshop',
    userId,
    'workshop',
  )
  await putFiles(id, {
    'index.html': [
      'text/html; charset=utf-8',
      `<!doctype html><script src="/_preview/pages.js"></script>
      <a href="#3">3</a>`,
    ],
  })
  const deck = `${TEST_ORIGIN}/@${handle}/workshop`
  await withContext(
    { viewport: { width: 390, height: 844 }, locale: 'ja-JP' },
    async (context) => {
      const page = await context.newPage()
      await page.goto(deck)
      await page
        .frameLocator('iframe#deck')
        .getByRole('link', { name: '3' })
        .click()
      await page.waitForURL(`${deck}/3`)
      await use(page, `${deck}/3`)
    },
  )
}

async function expectHiddenFollow(page: Page) {
  const byline = page.locator('.stage .author')
  expect(await byline.getByRole('link').allTextContents()).toEqual(['@speaker'])
  const follow = byline.locator('a[data-follow-handle]')
  expect(await follow.isVisible()).toBe(false)
  expect(
    await follow.evaluate((link) => {
      link.focus()
      return link === document.activeElement
    }),
  ).toBe(false)
}

// WebKit is left out: Playwright does not show its interceptor the cookies
// WebKit attaches, so the Worker here never sees the reader as signed in.
test.skipIf(engineName === 'webkit')(
  'F19-AC9 / F19-AC10: Given a reader following the author on page three at 390px, When they mute and unmute in the deck menu, Then focus and the document stay put and they can follow again',
  async () => {
    await withReaderOnPageThree(INVITED_ID, 'speaker', async (page, slide) => {
      const viewer = await page.evaluateHandle(() => document)
      const menu = page.locator('details.deck-menu')
      const mute = menu.getByRole('link', { name: 'この作者をミュート' })
      const release = menu.getByRole('link', {
        name: '@speaker のミュートを解除',
      })
      const follow = page.getByRole('link', { name: 'フォロー', exact: true })
      const expectFits = async () => {
        const box = await menu.locator('.menu').boundingBox()
        expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(390)
      }
      const expectSameViewer = async () => {
        expect(page.url()).toBe(slide)
        expect(await viewer.evaluate((original) => original === document)).toBe(
          true,
        )
      }

      const emptyLists = page.locator('[data-reader-lists]')
      expect(await emptyLists.count()).toBe(3)
      expect(
        await emptyLists.evaluateAll((lists) =>
          lists.every((list) => list.getClientRects().length === 0),
        ),
      ).toBe(true)
      await follow.click()
      await page.getByRole('link', { name: 'フォローを解除する' }).waitFor()
      await menu.locator('summary').click()
      await expectFits()
      expect(
        await menu.getByRole('link', { name: '通報する' }).getAttribute('href'),
      ).toBe(
        `/reports/new?slide=${encodeURIComponent(new URL(slide).pathname)}`,
      )
      const fallback = await mute.getAttribute('href')
      expect(await mute.getAttribute('title')).toBe(
        'この作者のスライドが、あなたに表示される一覧から外れます',
      )
      await mute.press('Enter')
      await release.waitFor()
      await expectSameViewer()
      expect(
        await menu.getByText('ミュート中', { exact: true }).isVisible(),
      ).toBe(true)
      expect((await release.textContent())?.trim()).toBe('解除')
      expect(await release.getAttribute('href')).toBe('/settings#mutes')
      expect(
        await release.evaluate((link) => link === document.activeElement),
      ).toBe(true)
      await expectHiddenFollow(page)
      await expectFits()

      const reopened = await page.context().newPage()
      await reopened.goto(slide)
      await expectHiddenFollow(reopened)
      await reopened.locator('details.deck-menu > summary').click()
      expect(
        await reopened
          .getByRole('link', { name: '@speaker のミュートを解除' })
          .isVisible(),
      ).toBe(true)
      await reopened.close()

      await release.press('Enter')
      await mute.waitFor()
      await expectSameViewer()
      expect(
        await mute.evaluate((link) => link === document.activeElement),
      ).toBe(true)
      expect(await mute.getAttribute('href')).toBe(fallback)
      expect(
        await menu.getByText('ミュート中', { exact: true }).isVisible(),
      ).toBe(false)
      expect(await follow.isVisible()).toBe(true)
      expect((await follow.textContent())?.trim()).toBe('フォロー')

      await page.reload()
      expect(await follow.isVisible()).toBe(true)
      await menu.locator('summary').click()
      expect(await mute.isVisible()).toBe(true)
      expect(await mute.getAttribute('href')).toBe(fallback)
    })
  },
  30000,
)

test.skipIf(engineName === 'webkit')(
  'F19-AC9: Given a reader on page three, When muting fails or release is refused, Then the links lead to mute confirmation and mute settings respectively',
  async () => {
    await withReaderOnPageThree('2349', 'panelist', async (page, slide) => {
      const path = new URL(slide).pathname
      const endpoint = `${TEST_ORIGIN}/mutes`
      await page.route(endpoint, (route) => route.fulfill({ status: 500 }), {
        times: 1,
      })
      await page.locator('details.deck-menu > summary').click()
      const mute = page.getByRole('link', { name: 'この作者をミュート' })
      const [request] = await Promise.all([
        page.waitForRequest(endpoint),
        mute.click(),
      ])
      expect(request.method()).toBe('POST')
      expect(
        Object.fromEntries(new URLSearchParams(request.postData() ?? '')),
      ).toEqual({ handle: 'panelist', slide: path })
      await page.waitForURL(
        `${endpoint}/new?${new URLSearchParams({ handle: 'panelist', slide: path })}`,
      )
      expect(
        await page
          .getByRole('link', { name: 'スライドに戻る' })
          .getAttribute('href'),
      ).toBe(path)
      await page.getByRole('button', { name: 'この作者をミュート' }).click()
      await page.waitForURL(slide)

      await page.route(`${endpoint}/panelist/release`, (route) =>
        route.fulfill({ json: { muted: true } }),
      )
      await page.locator('details.deck-menu > summary').click()
      await page
        .getByRole('link', { name: '@panelist のミュートを解除' })
        .click()
      await page.waitForURL(`${TEST_ORIGIN}/settings#mutes`)
    })
  },
  30000,
)

async function seedReaderLists(author: string, handle: string) {
  await orm.insert(accounts).values({ user_id: author, handle, created_at: 1 })
  const mainId = `${handle}-main`
  const companionId = `${handle}-companion`
  const peerId = `${handle}-peer`
  const main = await seedPublic(db, mainId, 10, 'Main talk', author, 'main')
  const companion = await seedPublic(
    db,
    companionId,
    9,
    'Companion',
    author,
    'companion',
  )
  const peer = await seedPage(peerId, 8, '<h1>Peer</h1>')
  await putFiles(main, { 'index.html': ['text/html', '<h1>Main talk</h1>'] })
  await putFiles(companion, {
    'index.html': [
      'text/html',
      `<a href="${TEST_ORIGIN}/@owner/${peerId}">Read cited talk</a>`,
    ],
  })
  await orm.insert(citations).values([
    {
      deployment_id: main,
      target_handle: handle,
      target_slug: 'companion',
      target_page: 0,
    },
    {
      deployment_id: main,
      target_handle: 'owner',
      target_slug: peerId,
      target_page: 0,
    },
    ...[companion, peer].map((deployment_id) => ({
      deployment_id,
      target_handle: handle,
      target_slug: 'main',
      target_page: 0,
    })),
  ])
  await orm
    .insert(communities)
    .values({ id: handle, name: handle, url: 'https://event.example/' })
  await orm.insert(events).values({
    id: handle,
    community_id: handle,
    name: 'Meetup',
    url: 'https://event.example/meetup',
    held_on: '2026-11-18',
  })
  await orm.insert(eventTalks).values(
    [mainId, companionId, peerId].map((deck_id, position) => ({
      event_id: handle,
      deck_id,
      position,
    })),
  )
  return `${TEST_ORIGIN}/@${handle}/main/3?lang=ja`
}

const muteMenu = (page: Page) => page.locator('details.deck-menu')
const unmuteLink = (page: Page, handle: string) =>
  muteMenu(page).getByRole('link', { name: `@${handle} のミュートを解除` })

async function expectLists(page: Page, handle: string, muted: boolean) {
  for (const key of ['cited-by', 'cites', 'event-talks']) {
    const list = page.locator(`[data-reader-lists="${key}"]`)
    expect(
      await list.getByRole('link', { name: `${handle}-peer` }).isVisible(),
    ).toBe(true)
    expect(await list.getByRole('link', { name: 'Companion' }).count()).toBe(
      muted ? 0 : 1,
    )
  }
}

async function markViewer(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(window, 'listViewerMarker', { value: true })
  })
}

async function expectReloaded(page: Page, url: string) {
  await page.waitForFunction(() => !('listViewerMarker' in window))
  await page.waitForLoadState('domcontentloaded')
  expect(page.url()).toBe(url)
}

test.skipIf(engineName === 'webkit')(
  'F19-AC2: Given related decks by two authors, When the reader mutes and unmutes on page three, Then all three lists update in the same viewer and the restored miniature is scaled and loaded',
  async () => {
    const handle = 'lists'
    const slide = await seedReaderLists('2350', handle)
    await withContext(
      { viewport: { width: 390, height: 844 } },
      async (context) => {
        const page = await context.newPage()
        await page.goto(slide)
        const original = await page.evaluateHandle(() => ({
          viewer: document,
          main: document.getElementById('deck'),
        }))
        const deckDocument = await page
          .frameLocator('#deck')
          .getByRole('heading', { name: 'Main talk' })
          .evaluateHandle((heading) => heading.ownerDocument)
        const expectSameViewer = async () => {
          expect(page.url()).toBe(slide)
          expect(
            await original.evaluate(
              ({ viewer, main }) =>
                viewer === document && main === document.getElementById('deck'),
            ),
          ).toBe(true)
          expect(await deckDocument.evaluate((deck) => deck === document)).toBe(
            true,
          )
          expect(await muteMenu(page).getAttribute('open')).not.toBeNull()
        }
        const mute = muteMenu(page).getByRole('link', {
          name: 'この作者をミュート',
        })
        const release = unmuteLink(page, handle)
        await expectLists(page, handle, false)
        await muteMenu(page).locator('summary').click()
        await mute.click()
        await page
          .locator('[data-reader-lists="cites"]')
          .getByRole('link', { name: 'Companion' })
          .waitFor({ state: 'detached' })
        await release.waitFor()
        expect(await release.getAttribute('aria-busy')).toBeNull()
        await expectLists(page, handle, true)
        await expectSameViewer()
        await release.click()
        const restored = page.locator(
          '[data-reader-lists="cites"] iframe[title="Companion"]',
        )
        await restored.scrollIntoViewIfNeeded()
        await mute.waitFor()
        await expectLists(page, handle, false)
        await expectSameViewer()
        const miniature = await (await restored.elementHandle())?.contentFrame()
        if (!miniature) throw new Error('Missing restored miniature')
        const link = miniature.getByRole('link', { name: 'Read cited talk' })
        await expect.poll(() => link.evaluate(() => innerWidth)).toBe(1280)
        // Scaled to the miniature's box, so the swapped-in frame is observed.
        await link.waitFor()
        expect(page.url()).toBe(slide)
      },
    )
  },
  30000,
)

test.skipIf(engineName === 'webkit')(
  'F19-AC2: Given the reader opened a muted deck, When release restores a miniature from a new origin, Then the viewer reloads on the same slide with the saved lists',
  async () => {
    const handle = 'muted-on-open'
    const slide = await seedReaderLists('2351', handle)
    await orm
      .insert(mutes)
      .values({ muter_user_id: OWNER_ID, muted_user_id: '2351', created_at: 1 })
    await withContext({}, async (context) => {
      const page = await context.newPage()
      await page.goto(slide)
      await expectLists(page, handle, true)
      await markViewer(page)
      await muteMenu(page).locator('summary').click()
      await unmuteLink(page, handle).click()
      await expectReloaded(page, slide)
      await expectLists(page, handle, false)
      const restored = page.locator(
        '[data-reader-lists="cites"] iframe[title="Companion"]',
      )
      await restored.scrollIntoViewIfNeeded()
      await restored
        .contentFrame()
        .getByRole('link', { name: 'Read cited talk' })
        .waitFor()
    })
  },
  30000,
)

test.skipIf(engineName === 'webkit')(
  'F19-AC2: Given muting succeeds but the viewer GET fails, When the reader stays on page three, Then a reload shows the saved mute and filtered lists',
  async () => {
    const handle = 'failed-refresh'
    const slide = await seedReaderLists('2352', handle)
    await withContext({}, async (context) => {
      const page = await context.newPage()
      await page.goto(slide)
      await markViewer(page)
      await page.route(slide, (route) => route.fulfill({ status: 500 }), {
        times: 1,
      })
      await muteMenu(page).locator('summary').click()
      const [request] = await Promise.all([
        page.waitForRequest(slide),
        muteMenu(page)
          .getByRole('link', { name: 'この作者をミュート' })
          .click(),
      ])
      expect(request.method()).toBe('GET')
      expect(request.isNavigationRequest()).toBe(false)
      expect(await request.headerValue('accept')).toBe('text/html')
      await expectReloaded(page, slide)
      await expectLists(page, handle, true)
      await muteMenu(page).locator('summary').click()
      expect(await unmuteLink(page, handle).isVisible()).toBe(true)
    })
  },
  30000,
)

test.skipIf(engineName === 'webkit')(
  'F19-AC2: Given five citing decks, When muting promotes a previously unframed deck, Then the same slide reloads with the promoted deck and updated count',
  async () => {
    const handle = 'promoted'
    const slide = await seedReaderLists('2353', handle)
    for (const rank of [3, 4, 5]) {
      const citing = await seedPage(
        `citing-${rank}`,
        8 - rank,
        `<h1>Citing ${rank}</h1>`,
      )
      await orm.insert(citations).values({
        deployment_id: citing,
        target_handle: handle,
        target_slug: 'main',
        target_page: 0,
      })
    }
    await withContext({}, async (context) => {
      const page = await context.newPage()
      await page.goto(slide)
      const list = page.locator('[data-reader-lists="cited-by"]')
      const promoted = list.getByRole('link', { name: 'citing-5' })
      expect(await promoted.count()).toBe(0)
      expect(await list.getByText('ほか 1 件').isVisible()).toBe(true)
      await markViewer(page)
      await muteMenu(page).locator('summary').click()
      await muteMenu(page)
        .getByRole('link', { name: 'この作者をミュート' })
        .click()
      await expectReloaded(page, slide)
      await expectLists(page, handle, true)
      expect(await promoted.isVisible()).toBe(true)
      expect(await list.getByText('ほか 1 件').count()).toBe(0)
      const restored = list.locator('iframe[title="citing-5"]')
      await restored.scrollIntoViewIfNeeded()
      await restored
        .contentFrame()
        .getByRole('heading', { name: 'Citing 5' })
        .waitFor()
    })
  },
  30000,
)

test.skipIf(engineName === 'webkit')(
  'F21-AC7: Given a signed-in reader on page three at 390px, When they follow and unfollow the author, Then the viewer stays open and reloading shows the saved state',
  async () => {
    await withReaderOnPageThree('2345', 'presenter', async (page, slide) => {
      const viewer = await page.evaluateHandle(() => document)
      const byline = page.locator('.stage .author')
      const follow = byline.getByRole('link', { name: 'フォロー', exact: true })
      const release = byline.getByRole('link', {
        name: 'フォローを解除する',
        exact: true,
      })
      const href = await follow.getAttribute('href')
      await follow.click()
      await expect.poll(() => release.isVisible()).toBe(true)
      expect((await release.textContent())?.trim()).toBe('フォロー中')
      expect(await release.getAttribute('title')).toBe('フォローを解除する')
      expect(await release.getAttribute('href')).toBe(href)
      expect(page.url()).toBe(slide)
      expect(await viewer.evaluate((original) => original === document)).toBe(
        true,
      )
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390)

      await release.click()
      await expect.poll(() => follow.isVisible()).toBe(true)
      expect((await follow.textContent())?.trim()).toBe('フォロー')
      expect(page.url()).toBe(slide)
      expect(await viewer.evaluate((original) => original === document)).toBe(
        true,
      )
      await page.reload()
      expect(await follow.isVisible()).toBe(true)
    })
  },
  30000,
)

test.skipIf(engineName === 'webkit')(
  'F21-AC7: Given a signed-in reader on page three, When the follow POST fails, Then the confirmation page offers a return to page three',
  async () => {
    await withReaderOnPageThree('2346', 'lecturer', async (page, slide) => {
      const path = new URL(slide).pathname
      const endpoint = `${TEST_ORIGIN}/follows`
      await page.route(endpoint, (route) => route.fulfill({ status: 500 }))
      const [request] = await Promise.all([
        page.waitForRequest(endpoint),
        page.getByRole('link', { name: 'フォロー', exact: true }).click(),
      ])
      expect(request.method()).toBe('POST')
      expect(
        Object.fromEntries(new URLSearchParams(request.postData() ?? '')),
      ).toEqual({
        handle: 'lecturer',
        slide: path,
      })
      await page.waitForURL(
        `${endpoint}/new?${new URLSearchParams({ handle: 'lecturer', slide: path })}`,
      )
      expect(
        await page.getByRole('link', { name: '戻る' }).getAttribute('href'),
      ).toBe(path)
    })
  },
  30000,
)

test.skipIf(engineName === 'webkit')(
  'Given a signed-in reader at 390px and an author with a long handle, When they open the menu and then follow, Then both menu items can be pressed and the page does not overflow while following',
  async () => {
    const author = '2347'
    const handle = 'presenter-with-a-long-github-handle'
    await orm.insert(accounts).values({
      user_id: author,
      handle,
      created_at: 1,
    })
    const id = await seedPublic(db, 'workshop', 4, 'Workshop', author)
    await putFiles(id, { 'index.html': ['text/html; charset=utf-8', 'Talk'] })
    await withContext(
      { viewport: { width: 390, height: 844 }, locale: 'ja-JP' },
      async (context) => {
        const page = await context.newPage()
        await page.goto(`${TEST_ORIGIN}/@${handle}/workshop`)
        const byline = page.locator('.stage .author')
        const menu = page.locator('details.deck-menu')
        await menu.locator('summary').click()
        // `trial` runs the checks a real press needs: visible, not covered.
        await menu
          .getByRole('link', { name: '通報する' })
          .click({ trial: true })
        await menu
          .getByRole('link', { name: 'この作者をミュート' })
          .click({ trial: true })
        await menu.locator('summary').click()
        await byline
          .getByRole('link', { name: 'フォロー', exact: true })
          .click()
        // The wider "following" control beside a long handle still fits.
        const following = byline.getByRole('link', {
          name: 'フォローを解除する',
          exact: true,
        })
        await expect.poll(() => following.isVisible()).toBe(true)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(390)
      },
    )
  },
  30000,
)

test.skipIf(engineName === 'webkit')(
  'F21-AC5: Given a reader who muted the author after opening the deck, When they press Follow, Then the confirmation page explains the mute instead of nothing happening',
  async () => {
    await withReaderOnPageThree('2348', 'speaker-two', async (page, slide) => {
      await orm.insert(mutes).values({
        muter_user_id: OWNER_ID,
        muted_user_id: '2348',
        created_at: 2,
      })
      await page.getByRole('link', { name: 'フォロー', exact: true }).click()
      await page.waitForURL(/\/follows\/new\?/)
      expect(await page.content()).toContain(
        '設定でミュートを解除してください。',
      )
      expect(
        await page.getByRole('link', { name: '戻る' }).getAttribute('href'),
      ).toBe(new URL(slide).pathname)
    })
  },
  30000,
)
