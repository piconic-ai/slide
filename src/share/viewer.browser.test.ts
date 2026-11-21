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
  type Locator,
  type Page,
  type Request as PlaywrightRequest,
  type Route,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { accounts, citations, mutes, uploadFiles } from '../db/schema'
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
    <a id="elsewhere" href="https://elsewhere.example/landing">elsewhere</a>
    <a id="profile" href="${TEST_ORIGIN}/@owner">profile</a>
    <a id="manage" href="${TEST_ORIGIN}/slides">manage</a>
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
    // The viewer's own script asks who is signed in, with the reader's
    // cookie; only what author content asks is of interest here. The frame
    // is read for API requests alone: a navigation may not have one yet.
    if (
      url.hostname === 'slide.example' &&
      url.pathname.startsWith('/api/') &&
      new URL(request.frame().url()).origin !== TEST_ORIGIN
    )
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

test('F24-AC9: Given a deck linking to a page of a share URL, When a reader follows the link, Then the viewer opens the slides at that page and going back returns to the deck', async () => {
  await withContext({}, async (context) => {
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/talk`)
    await page.frameLocator('iframe').locator('#cite').click()
    await page.waitForURL(`${TEST_ORIGIN}/@owner/talk/3`)
    await expect
      .poll(() => page.frameLocator('iframe').locator('#title').textContent())
      .toBe('Deck')
    // The slides are told the page the link named.
    expect(await page.locator('iframe#deck').getAttribute('src')).toMatch(
      /\.content\.example\/#3$/,
    )
    await page.goBack()
    await expect
      .poll(() => page.frameLocator('iframe').locator('#title').textContent())
      .toBe('Deck')
    // Returning must not follow the link again.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/talk`)
  })
}, 20000)

test('F24-AC9: Given the viewer’s script starts after the deck has loaded, When a reader follows a link in the deck, Then the first click opens that page', async () => {
  await withContext({ serving: { lateScript: true } }, async (context) => {
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/talk`)
    await page.frameLocator('iframe').locator('#cite').click()
    await page.waitForURL(`${TEST_ORIGIN}/@owner/talk/3`, { timeout: 5000 })
  })
}, 20000)

test('F24-AC10: Given a deck that asks the viewer to open a path itself, When the viewer hears it, Then the viewer stays where it is', async () => {
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

test.each([
  ['another site', '#elsewhere'],
  ['an author’s profile on the service', '#profile'],
  ['a page of the service that is no share URL', '#manage'],
])(
  'F24-AC10: Given a deck linking to %s, When a reader follows the link, Then the viewer stays where it is and opens no other page',
  async (_, link) => {
    await withContext({}, async (context) => {
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/@owner/talk`)
      const frame = page.frameLocator('iframe')
      await expect
        .poll(() => frame.locator('#probes').textContent())
        .not.toBe('')
      await frame.locator(link).click()
      await new Promise((resolve) => setTimeout(resolve, 1000))
      expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/talk`)
      expect(context.pages()).toHaveLength(1)
    })
  },
  20000,
)

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

test.each([
  ['ja', '共有', 'URL をコピー', 'コピーしました'],
  ['en', 'Share', 'Copy link', 'Copied'],
])(
  'Given a phone-sized browser on the %s page, When the share URL is opened, Then the deck fills the width without horizontal scrolling and the link can be copied from the share menu',
  async (lang, share, copy, copied) => {
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
      await page
        .locator('details.share-menu > summary', { hasText: share })
        .click()
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
      await page.locator('#share-page-url').inputValue(),
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
    expect(await page.locator('#share-page-url').inputValue()).toBe(
      `${TEST_ORIGIN}/@owner/paged/3`,
    )
    // The URL of the slides as a whole does not follow the page.
    expect(await page.locator('#share-url').inputValue()).toBe(
      `${TEST_ORIGIN}/@owner/paged`,
    )
  })
}, 30000)

test.each([
  ['a desktop browser', {}],
  ['a phone-sized browser', { viewport: { width: 390, height: 844 } }],
])(
  'F17-AC16: Given %s, When the reader opens the menu beside the title, Then “report” appears inside the page, leads to the report page for this deck, and opens the sign-in prompt in place',
  async (_, options) => {
    await withContext(options, async (context) => {
      const page = await context.newPage()
      // The language is chosen in the URL: engines differ in what they ask for.
      await page.goto(`${TEST_ORIGIN}/@owner/talk?lang=ja`)
      const report = page.getByRole('link', { name: '通報する' })
      await expect.poll(() => report.isVisible()).toBe(false)

      await page.locator('details.more-menu > summary').click()
      await expect.poll(() => report.isVisible()).toBe(true)
      // The title and the author under it start at the same edge.
      const left = (selector: string) =>
        page
          .locator(selector)
          .evaluate((element) => element.getBoundingClientRect().left)
      expect(await left('.viewer-author')).toBe(await left('.viewer-title h1'))
      const box = await report.boundingBox()
      const width = page.viewportSize()?.width ?? 0
      expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      ).toBeLessThanOrEqual(0)

      // Without scripts the link leads to the report page for this deck.
      const href = await report.getAttribute('href')
      expect(new URL(href ?? '', TEST_ORIGIN).searchParams.get('slide')).toBe(
        '/@owner/talk',
      )
      // A reader who is not signed in is asked to sign in, in a modal, in
      // place (F03-AC91).
      await report.click()
      await expect
        .poll(() => page.locator('.login-prompt[role="dialog"]').isVisible())
        .toBe(true)
      expect(new URL(page.url()).pathname).toBe('/@owner/talk')
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
  const byline = page.locator('.viewer-author')
  expect(
    await byline
      .locator('a:visible')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  ).toEqual(['/@speaker'])
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
      const menu = page.locator('details.more-menu')
      const mute = menu.getByRole('link', { name: 'この作者をミュート' })
      const release = menu.getByRole('link', {
        name: '@speaker のミュートを解除',
      })
      const follow = page.getByRole('link', { name: 'フォロー', exact: true })
      const expectFits = async () => {
        const box = await menu.locator('.menu-items').boundingBox()
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
      expect(await emptyLists.count()).toBe(2)
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
      await reopened.locator('details.more-menu > summary').click()
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

/** What one place of the viewer's citations shows to the reader now. */
const readerList = (page: Page, name: 'cites' | 'cited-by') =>
  page.locator(`[data-reader-lists="${name}"]`).evaluate((place) => ({
    visible: place.getClientRects().length > 0,
    heading: place.querySelector('h2')?.textContent?.trim() ?? null,
    cards: Array.from(place.querySelectorAll('a.card-title'), (link) =>
      link.getAttribute('href'),
    ),
    more: place.querySelector('.citations-more')?.textContent?.trim() ?? null,
    frames: place.querySelectorAll('iframe').length,
    // A cover either shows or is hidden; none is left as a broken image.
    brokenCovers: Array.from(
      place.querySelectorAll<HTMLImageElement>('img[data-cover]'),
    ).filter((image) => image.complete && !image.naturalWidth && !image.hidden)
      .length,
    hiddenCovers: Array.from(
      place.querySelectorAll<HTMLImageElement>('img[data-cover]'),
    )
      .filter((image) => image.hidden)
      .map((image) => image.closest('a')?.getAttribute('href')),
  }))

// WebKit is left out as above: its cookies do not reach the interceptor.
test.skipIf(engineName === 'webkit')(
  'F24-AC8, F19-AC2: Given a viewer listing decks on both sides of its citations, When the reader mutes the author of some of them and releases, Then the cards and the count follow each time while the page and the slides stay as they are',
  async () => {
    await orm
      .insert(accounts)
      .values({ user_id: '2350', handle: 'curator', created_at: 1 })
    const anthology = await seedPage('anthology', 50, '<h1 id="title">A</h1>')
    const sequel = await seedPage('sequel', 60, '<h1 id="title">S</h1>')
    await db
      .prepare("UPDATE decks SET owner_user_id = '2350' WHERE id IN (?, ?)")
      .bind('anthology', 'sequel')
      .run()
    const extra = await seedPage('extra', 3, '<h1 id="title">E</h1>')
    // A cover that cannot be read, on a card that stays through the mute.
    await db
      .prepare('UPDATE deployments SET cover_path = ? WHERE id = ?')
      .bind('missing.png', extra)
      .run()
    await orm.insert(citations).values([
      ...[
        ['curator', 'sequel'],
        ['owner', 'extra'],
        ['owner', 'pushing'],
        ['owner', 'cited'],
        ['owner', 'talk'],
      ].map(([target_handle, target_slug]) => ({
        deployment_id: anthology,
        target_handle,
        target_slug,
        target_page: 0,
      })),
      {
        deployment_id: sequel,
        target_handle: 'curator',
        target_slug: 'anthology',
        target_page: 2,
      },
    ])
    const before = {
      cites: [
        '/@curator/sequel',
        '/@owner/extra',
        '/@owner/pushing',
        '/@owner/cited',
      ],
      more: 'ほか 1 件',
      citedBy: ['/@curator/sequel'],
    }
    await withContext({ locale: 'ja-JP' }, async (context) => {
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/@curator/anthology`)
      const viewer = await page.evaluateHandle(() => document)
      const deck = await page.locator('iframe#deck').elementHandle()
      const expectBefore = async () => {
        await expect
          .poll(async () => (await readerList(page, 'cites')).cards)
          .toEqual(before.cites)
        const cites = await readerList(page, 'cites')
        expect(cites.heading).toBe('このスライドが引用しているスライド')
        expect(cites.more).toBe(before.more)
        const citedBy = await readerList(page, 'cited-by')
        expect(citedBy.heading).toBe('このスライドを引用しているスライド')
        expect(citedBy.cards).toEqual(before.citedBy)
        expect(citedBy.more).toBeNull()
      }
      const expectSettled = async () => {
        for (const name of ['cites', 'cited-by'] as const) {
          await expect
            .poll(async () => (await readerList(page, name)).brokenCovers)
            .toBe(0)
          expect((await readerList(page, name)).frames).toBe(0)
        }
        await expect
          .poll(async () => (await readerList(page, 'cites')).hiddenCovers)
          .toEqual(['/@owner/extra'])
        // The same document and the same frame: nothing was loaded again.
        expect(await viewer.evaluate((original) => original === document)).toBe(
          true,
        )
        expect(
          await deck?.evaluate(
            (frame) => frame === document.querySelector('iframe#deck'),
          ),
        ).toBe(true)
        expect(await page.locator('iframe').count()).toBe(1)
      }
      await expectBefore()
      await expectSettled()

      const menu = page.locator('details.more-menu')
      await menu.locator('summary').click()
      await menu
        .getByRole('link', { name: 'この作者をミュート' })
        .press('Enter')
      const release = menu.getByRole('link', {
        name: '@curator のミュートを解除',
      })
      await release.waitFor()

      // The muted author's deck leaves both sides; the next one moves up.
      await expect
        .poll(async () => (await readerList(page, 'cites')).cards)
        .toEqual([
          '/@owner/extra',
          '/@owner/pushing',
          '/@owner/cited',
          '/@owner/talk',
        ])
      expect((await readerList(page, 'cites')).more).toBeNull()
      expect(await readerList(page, 'cited-by')).toMatchObject({
        visible: false,
        heading: null,
        cards: [],
      })
      await expectSettled()

      await release.press('Enter')
      await menu.getByRole('link', { name: 'この作者をミュート' }).waitFor()
      await expectBefore()
      await expectSettled()
    })
  },
  40000,
)

test.skipIf(engineName === 'webkit')(
  'F19-AC9: Given a reader on page three, When muting fails or release is refused, Then the links lead to mute confirmation and mute settings respectively',
  async () => {
    await withReaderOnPageThree('2349', 'panelist', async (page, slide) => {
      const path = new URL(slide).pathname
      const endpoint = `${TEST_ORIGIN}/mutes`
      await page.route(endpoint, (route) =>
        route.request().isNavigationRequest()
          ? route.fallback()
          : route.fulfill({ status: 500 }),
      )
      await page.locator('details.more-menu > summary').click()
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
      await page.locator('details.more-menu > summary').click()
      await page
        .getByRole('link', { name: '@panelist のミュートを解除' })
        .click()
      await page.waitForURL(`${TEST_ORIGIN}/settings#mutes`)
    })
  },
  30000,
)

test.skipIf(engineName === 'webkit')(
  'F21-AC7: Given a signed-in reader on page three at 390px, When they follow and unfollow the author, Then the viewer stays open and reloading shows the saved state',
  async () => {
    await withReaderOnPageThree('2345', 'presenter', async (page, slide) => {
      const viewer = await page.evaluateHandle(() => document)
      const byline = page.locator('.viewer-author')
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
        const byline = page.locator('.viewer-author')
        const menu = page.locator('details.more-menu')
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

test('Given a browser that refuses the clipboard, When the reader presses “copy link” in the share menu, Then the share URL shows selected in the menu, ready to copy by hand', async () => {
  await withContext({ locale: 'ja-JP' }, async (context) => {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('refused')) },
      })
    })
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/talk`)
    const menu = page.locator('details.share-menu')
    await menu.locator('summary').click()
    const url = menu.locator('input#share-url')
    expect(await url.isVisible()).toBe(true)
    expect(await url.getAttribute('aria-label')).toBe('共有 URL')

    await menu.getByRole('button', { name: 'URL をコピー' }).click()

    await expect
      .poll(() =>
        url.evaluate((input: HTMLInputElement) => [
          input === document.activeElement,
          input.selectionStart,
          input.selectionEnd === input.value.length,
          input.value,
        ]),
      )
      .toEqual([true, 0, true, `${TEST_ORIGIN}/@owner/talk`])
    // Nothing claims a copy that did not happen.
    expect(await menu.getByText('コピーしました').count()).toBe(0)
    expect(
      await menu.evaluate((details: HTMLDetailsElement) => details.open),
    ).toBe(true)
  })
}, 20000)

test.each(['share-menu', 'more-menu'])(
  'Given the %s is open, When the reader presses inside the slides, Then the menu closes although the press never reaches the viewer',
  async (name) => {
    await withContext({ locale: 'ja-JP' }, async (context) => {
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/@owner/talk`)
      const frame = page.frameLocator('iframe#deck')
      await expect
        .poll(() => frame.locator('#module').textContent())
        .toBe('module ok')
      const menu = page.locator(`details.${name}`)
      const summary = menu.locator('summary')
      await summary.click()
      await expect
        .poll(() => summary.getAttribute('aria-expanded'))
        .toBe('true')
      // Leaving the window for another does not close an open menu. This
      // comes before the press: Playwright's Firefox keeps the frame as the
      // active element once it was pressed.
      await page.evaluate(async () => {
        window.dispatchEvent(new Event('blur'))
        // The page decides in a later task, which has run by now.
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(await summary.getAttribute('aria-expanded')).toBe('true')

      await frame.locator('#module').click()
      // Playwright's Firefox keeps every page focused and fires no blur when
      // the focus moves into the frame, although Firefox itself fires one.
      // The press above still made the frame the active element; only the
      // event is sent here.
      if (engineName === 'firefox')
        await page.evaluate(() => window.dispatchEvent(new Event('blur')))

      await expect
        .poll(() => summary.getAttribute('aria-expanded'))
        .toBe('false')
      expect(await menu.locator('.menu-items').isVisible()).toBe(false)
    })
  },
  20000,
)

const SHARED_TITLE = 'Sharing "slides" & more'
let sharedSeeded: Promise<void> | null = null
/** Public slides that tell their page, under a title that needs escaping. */
const seedShared = () =>
  (sharedSeeded ??= (async () => {
    const id = await seedPublic(db, 'shared', 6, SHARED_TITLE)
    await putFiles(id, {
      'index.html': [
        'text/html; charset=utf-8',
        `<!doctype html><script src="/_preview/pages.js"></script>
        <h1 id="title">Shared</h1>`,
      ],
    })
  })())

/**
 * What the page last copied. Chromium is given the real clipboard; the
 * other engines grant no way to read it, so there the write is recorded.
 */
async function clipboardOf(context: BrowserContext) {
  if (engineName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: TEST_ORIGIN,
    })
    return (page: Page) => page.evaluate(() => navigator.clipboard.readText())
  }
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          ;(window as unknown as { copied: string }).copied = text
        },
      },
    })
  })
  return (page: Page) =>
    page.evaluate(() => (window as unknown as { copied?: string }).copied ?? '')
}

test('F03-AC12: Given the viewer, When the reader presses “share”, Then the menu opens, and pressing it again, pressing outside it, or Escape each close it, by keyboard as well', async () => {
  await withContext({ locale: 'ja-JP' }, async (context) => {
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/talk`)
    const menu = page.locator('details.share-menu')
    const summary = menu.locator('summary')
    const items = menu.locator('.menu-items')
    const state = async () => [
      await summary.getAttribute('aria-expanded'),
      await items.isVisible(),
    ]
    expect(await state()).toEqual(['false', false])

    await summary.click()
    await expect.poll(state).toEqual(['true', true])
    await summary.click()
    await expect.poll(state).toEqual(['false', false])

    await summary.click()
    await expect.poll(state).toEqual(['true', true])
    await page.locator('.viewer-title h1').click()
    await expect.poll(state).toEqual(['false', false])

    // With the keyboard alone: Enter opens, Tab reaches the first action,
    // and Escape closes and hands the focus back to the button.
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect.poll(state).toEqual(['true', true])
    // WebKit, like Safari, moves to buttons and links with Option+Tab.
    const tab = engineName === 'webkit' ? 'Alt+Tab' : 'Tab'
    await page.keyboard.press(tab)
    await page.keyboard.press(tab)
    expect(
      await page.evaluate(() => document.activeElement?.textContent?.trim()),
    ).toBe('URL をコピー')
    await page.keyboard.press('Escape')
    await expect.poll(state).toEqual(['false', false])
    expect(
      await summary.evaluate((element) => element === document.activeElement),
    ).toBe(true)
  })
}, 20000)

test('F03-AC13, F03-AC14, F03-AC18: Given a reader on page 3 of slides that tell their page, When they copy the link and then the link to this page, Then the clipboard holds the share URL without a page, then /@handle/slug/3, and each copy is said in the button and in a status line', async () => {
  await seedShared()
  await withContext({ locale: 'ja-JP' }, async (context) => {
    const copied = await clipboardOf(context)
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/shared/3`)
    const menu = page.locator('details.share-menu')
    await menu.locator('summary').click()
    const copyPage = menu.locator('button[data-share-page]')
    await expect.poll(() => copyPage.isVisible()).toBe(true)
    const status = menu.getByRole('status')
    expect(await status.textContent()).toBe('')

    await menu
      .getByRole('button', { name: 'URL をコピー', exact: true })
      .click()
    await expect.poll(() => status.textContent()).toBe('コピーしました')
    expect(await copied(page)).toBe(`${TEST_ORIGIN}/@owner/shared`)
    // Said where the reader pressed, too.
    expect(
      await menu.locator('button[data-copy="share-url"]').textContent(),
    ).toContain('コピーしました')

    await copyPage.click()
    await expect.poll(() => copied(page)).toBe(`${TEST_ORIGIN}/@owner/shared/3`)
    expect(await copyPage.textContent()).toContain('コピーしました')
    expect(await status.textContent()).toBe('コピーしました')
    // Both go back, so the next copy is said and read out anew.
    await expect
      .poll(
        async () => [
          await status.textContent(),
          (await copyPage.textContent())?.trim(),
        ],
        { timeout: 5000 },
      )
      .toEqual(['', 'いま見ているページの URL をコピー'])
  })
}, 30000)

test('F03-AC17, F25-AC1: Given the viewer of public slides, When the reader presses “copy embed code”, Then the clipboard holds the code oEmbed answers for the slides, and the copy is said', async () => {
  await seedShared()
  await withContext({ locale: 'ja-JP' }, async (context) => {
    const copied = await clipboardOf(context)
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/shared/3`)
    const menu = page.locator('details.share-menu')
    await menu.locator('summary').click()
    const button = menu.getByRole('button', { name: '埋め込みコードをコピー' })
    // The code is not shown until the clipboard refuses it.
    expect(await menu.locator('#embed-code').isVisible()).toBe(false)

    await button.click()

    await expect
      .poll(() => menu.getByRole('status').textContent())
      .toBe('コピーしました')
    const share = `${TEST_ORIGIN}/@owner/shared`
    const answer = (await (
      await server.fetch(
        new Request(`${TEST_ORIGIN}/oembed?url=${encodeURIComponent(share)}`),
        env,
      )
    ).json()) as { html: string }
    expect(await copied(page)).toBe(answer.html)
    // Without a page number, whatever page the reader is on.
    expect(answer.html).toContain(`src="${TEST_ORIGIN}/embed/@owner/shared"`)
  })
}, 30000)

test('F03-AC15, F03-AC16: Given slides without the script that tells their page, opened at /3, When the reader opens the share menu, Then copying the page’s link is not offered and the posts carry the share URL without a page', async () => {
  await withContext({ locale: 'ja-JP' }, async (context) => {
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/talk/3`)
    const frame = page.frameLocator('iframe#deck')
    await expect
      .poll(() => frame.locator('#module').textContent())
      .toBe('module ok')
    const menu = page.locator('details.share-menu')
    await menu.locator('summary').click()
    await expect
      .poll(() => menu.getByRole('button', { name: 'URL をコピー' }).count())
      .toBe(1)
    expect(await menu.locator('[data-share-page]').isVisible()).toBe(false)
    expect(await menu.locator('#share-page-url').isVisible()).toBe(false)
    expect(await menu.locator('#share-url').inputValue()).toBe(
      `${TEST_ORIGIN}/@owner/talk`,
    )
    for (const name of ['X に投稿', 'Bluesky に投稿']) {
      const href = await menu.getByRole('link', { name }).getAttribute('href')
      const sent = [...new URL(href ?? '').searchParams.values()].join(' ')
      expect(sent).toContain(`${TEST_ORIGIN}/@owner/talk`)
      expect(sent).not.toContain('/talk/3')
    }
  })
}, 20000)

test.each([
  ['X に投稿', 'https://x.com/intent/post', 'url'],
  ['Bluesky に投稿', 'https://bsky.app/intent/compose', 'text'],
])(
  'F03-AC16: Given a reader on page 3, When they press “%s”, Then a new tab asks %s for a post with the title and the URL of page 3, and the viewer stays',
  async (name, compose, urlIn) => {
    await seedShared()
    await withContext({ locale: 'ja-JP' }, async (context, observed) => {
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/@owner/shared/3`)
      const menu = page.locator('details.share-menu')
      await menu.locator('summary').click()
      await expect
        .poll(() => menu.locator('button[data-share-page]').isVisible())
        .toBe(true)

      const opening = context.waitForEvent('page')
      await menu.getByRole('link', { name }).click()
      const opened = await opening

      const asked = () =>
        observed.requests.filter((url) => url.startsWith(compose))
      await expect.poll(() => asked().length).toBe(1)
      const sent = new URL(asked()[0] ?? '').searchParams
      const shared = `${TEST_ORIGIN}/@owner/shared/3`
      expect(sent.get('text')).toBe(
        urlIn === 'text' ? `${SHARED_TITLE} ${shared}` : SHARED_TITLE,
      )
      if (urlIn === 'url') expect(sent.get('url')).toBe(shared)
      // The post opens beside the viewer, which stays where it was.
      expect(opened).not.toBe(page)
      expect(context.pages()).toHaveLength(2)
      expect(new URL(page.url()).pathname).toBe('/@owner/shared/3')
    })
  },
  30000,
)

test.each([
  ['can hand a link to another app', true],
  ['cannot hand a link to another app', false],
])(
  'F03-AC19: Given a browser that %s, When the reader opens the share menu on page 3, Then “share with another app” is offered only where it works, and passes the title and the URL of page 3',
  async (_, able) => {
    await seedShared()
    await withContext({ locale: 'ja-JP' }, async (context) => {
      await context.addInitScript((can) => {
        const shared: unknown[] = []
        Object.defineProperty(window, 'shared', { value: shared })
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: can
            ? async (data: unknown) => void shared.push(data)
            : undefined,
        })
      }, able)
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/@owner/shared/3`)
      const menu = page.locator('details.share-menu')
      await menu.locator('summary').click()
      await expect
        .poll(() => menu.locator('button[data-share-page]').isVisible())
        .toBe(true)
      const other = menu.locator('button[data-share-native]')
      expect(await other.isVisible()).toBe(able)
      if (!able) return
      expect((await other.textContent())?.trim()).toBe('ほかのアプリで共有')

      await other.click()

      expect(
        await page.evaluate(
          () => (window as unknown as { shared: unknown[] }).shared,
        ),
      ).toEqual([
        { title: SHARED_TITLE, url: `${TEST_ORIGIN}/@owner/shared/3` },
      ])
    })
  },
  20000,
)

test('Given a menu is open, When the window loses focus before the frame becomes the active element, Then the menu closes', async () => {
  await withContext({ locale: 'ja-JP' }, async (context) => {
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/@owner/talk`)
    const summary = page.locator('details.share-menu summary')
    await summary.click()
    await expect.poll(() => summary.getAttribute('aria-expanded')).toBe('true')

    // Firefox's order for a press inside the slides: the blur comes first,
    // and the frame is the active element only afterwards.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'))
      document.querySelector<HTMLIFrameElement>('iframe#deck')?.focus()
    })

    await expect.poll(() => summary.getAttribute('aria-expanded')).toBe('false')
  })
}, 20000)

// Last in this file: it ends the session the other tests are signed in with.
// WebKit is left out as above: its cookies do not reach the interceptor.
test.skipIf(engineName === 'webkit')(
  'F03-AC24: Given a signed-in reader on the viewer, which lets no form be sent, When they sign out from the header’s menu, Then the session ends, the policy refuses nothing, and the viewer shows the way in',
  async () => {
    await withContext({ locale: 'ja-JP' }, async (context) => {
      const page = await context.newPage()
      const refusals: string[] = []
      page.on('console', (message) => {
        // The deck's own probes are refused things too; only a refused
        // form is of interest here.
        if (/form-action/.test(message.text())) refusals.push(message.text())
      })
      const session = async () =>
        (
          await server.fetch(
            new Request(`${TEST_ORIGIN}/api/session`, {
              headers: { Cookie: ownerCookie },
            }),
            env,
          )
        ).json() as Promise<{ signedIn: boolean }>
      expect((await session()).signedIn).toBe(true)
      const policy = (
        await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk`), env)
      ).headers.get('Content-Security-Policy')
      expect(policy).toContain("form-action 'none'")

      await page.goto(`${TEST_ORIGIN}/@owner/talk`)
      const icon = page.locator('.site-header summary.avatar')
      await icon.click()
      await page
        .locator('.site-header .menu-items')
        .getByRole('button', { name: 'ログアウト' })
        .click()

      await expect.poll(async () => (await session()).signedIn).toBe(false)
      await expect
        .poll(() => page.locator('.site-header a.sign-in').count())
        .toBe(1)
      expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/talk`)
      expect(refusals).toEqual([])
    })
  },
  20000,
)
