import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, devices, type Browser, type Route } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
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
    document.querySelector('#module').textContent = answer
    const results = {}
    results.cookie = document.cookie
    try { results.parent = String(parent.document.body) } catch { results.parent = 'blocked' }
    try { top.location.href = 'https://elsewhere.example/'; results.top = 'tried' } catch { results.top = 'blocked' }
    results.popup = window.open('https://elsewhere.example/') === null ? 'blocked' : 'opened'
    const probes = [
      navigator.serviceWorker
        ? navigator.serviceWorker.register('/sw.js').then(() => 'registered', () => 'blocked')
        : Promise.resolve('unavailable'),
      fetch('${TEST_ORIGIN}/api/decks', { credentials: 'include' })
        .then((r) => r.text()).then((body) => body, () => 'blocked'),
    ]
    Promise.all(probes).then(([worker, api]) => {
      results.worker = worker
      results.api = api
      document.querySelector('#form').requestSubmit()
      document.querySelector('#probes').textContent = JSON.stringify(results)
    })`,
  ],
  'sw.js': ['text/javascript', 'self.addEventListener("fetch", () => {})'],
  'next/index.html': ['text/html', '<p id="index">directory index</p>'],
}

let browser: Browser
let deploymentId = ''
let ownerCookie = ''
const outside: string[] = []
/** Management API requests made from author content, with the answers. */
const apiCalls: {
  cookie: string | null
  status: number
  allowOrigin: string | null
}[] = []

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
    await db
      .prepare('INSERT INTO upload_files VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(deploymentId, String(index), path, body.length, digest, type, key)
      .run()
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
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

/** Answers every browser request with the Worker, as Cloudflare would. */
async function serve(route: Route) {
  const request = route.request()
  const url = new URL(request.url())
  if (
    url.hostname !== 'slide.example' &&
    !url.hostname.endsWith('.content.example')
  ) {
    outside.push(url.href)
    return route.abort()
  }
  const body = request.postDataBuffer()
  const response = await server.fetch(
    new Request(url, {
      method: request.method(),
      headers: await request.allHeaders(),
      body: body && request.method() !== 'GET' ? new Uint8Array(body) : undefined,
      redirect: 'manual',
    }),
    env,
  )
  if (url.hostname === 'slide.example' && url.pathname.startsWith('/api/'))
    apiCalls.push({
      cookie: (await request.allHeaders()).cookie ?? null,
      status: response.status,
      allowOrigin: response.headers.get('Access-Control-Allow-Origin'),
    })
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: Buffer.from(await response.arrayBuffer()),
  })
}

async function openViewer(options = {}) {
  const context = await browser.newContext(options)
  // The owner is signed in on the management origin while reading.
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
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await context.route('**/*', serve)
  await page.goto(`${TEST_ORIGIN}/@owner/talk`)
  const frame = page.frameLocator('iframe')
  return { context, page, frame, requests }
}

test('Given a published deck, When a reader opens its share URL, Then module, relative and root-relative files load in the frame', async () => {
  const { context, frame } = await openViewer()
  try {
    await expect
      .poll(() => frame.locator('#module').textContent())
      .toBe('module ok')
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
  } finally {
    await context.close()
  }
}, 20000)

test('Given author JS in the frame, When it probes the viewer, Then credentials, the parent, top navigation, popups, forms, service workers and management API stay out of reach', async () => {
  const { context, page, frame, requests } = await openViewer()
  try {
    await expect.poll(() => frame.locator('#probes').textContent()).not.toBe('')
    const results = JSON.parse(
      (await frame.locator('#probes').textContent()) ?? '{}',
    )
    expect(results).toMatchObject({
      cookie: '',
      parent: 'blocked',
      popup: 'blocked',
      worker: 'blocked',
    })
    // Playwright's fulfilled responses skip the browser's CORS check, so
    // the request itself is checked: no owner cookie, refused, no CORS grant.
    expect(apiCalls).not.toHaveLength(0)
    for (const call of apiCalls) {
      expect(call.cookie).toBeNull()
      expect(call.status).toBeGreaterThanOrEqual(400)
      expect(call.allowOrigin).toBeNull()
    }
    expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/talk`)
    expect(context.pages()).toHaveLength(1)
    expect(requests.some((url) => url.endsWith('/submit'))).toBe(false)
    expect(requests.some((url) => url.endsWith('/sw.js'))).toBe(false)
    expect(outside).toEqual([])
  } finally {
    await context.close()
  }
}, 20000)

test('Given a phone, When the share URL is opened, Then the deck fills the width without horizontal scrolling and the link can be copied', async () => {
  const { context, page, frame } = await openViewer({
    ...devices['iPhone 13'],
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  try {
    await expect
      .poll(() => frame.locator('#module').textContent())
      .toBe('module ok')
    const layout = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: window.innerWidth,
      frame: document.querySelector('iframe')?.getBoundingClientRect().width,
    }))
    expect(layout.scroll).toBeLessThanOrEqual(layout.width)
    expect(layout.frame).toBe(layout.width)
    await page.getByRole('button', { name: 'リンクをコピー' }).click()
    await expect
      .poll(() => page.getByRole('button', { name: 'コピーしました' }).count())
      .toBe(1)
  } finally {
    await context.close()
  }
}, 20000)
