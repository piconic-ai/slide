import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { chromium, firefox, webkit, type Page } from 'playwright'
import { openTestBrowser } from '../test-open-browser'

/**
 * D-95: whether a service worker and Cache Storage work inside the frame
 * the viewer gives a version (a frame of another site, `sandbox="allow-scripts
 * allow-same-origin"`), tried on a plain HTTP server so that the browser's own
 * network stack decides, not Playwright's routing. Run with BROWSER=chromium,
 * firefox or webkit (docs/dev/f37-offline-reading.md records the results).
 */
const engineName = process.env.BROWSER ?? 'chromium'
const engine = { chromium, firefox, webkit }[engineName]
if (!engine) throw new Error(`Unknown BROWSER: ${engineName}`)

// Launching Firefox and waiting for its frame take a while.
vi.setConfig({ testTimeout: 60_000 })

const WORKER_PATH = '/_preview/sw.js'
const FRAME_SANDBOX = 'allow-scripts allow-same-origin'

/** A worker that answers from the cache when the network does not. */
const WORKER = `
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).pathname.startsWith('/_preview/')) return
  event.respondWith((async () => {
    try {
      const live = await fetch(event.request)
      if (live.status >= 500) throw new Error('5xx')
      await (await caches.open('v1')).put(event.request, live.clone())
      return live
    } catch {
      return (await caches.match(event.request)) ?? new Response('none', { status: 504 })
    }
  })())
})`

/** The frame's page: tries what the viewer's offline feature will try. */
const FRAME = `<!doctype html><p id="hello">frame live</p><script>
;(async () => {
  const r = {}
  const done = () => parent.postMessage({ probe: r }, '*')
  if (!('serviceWorker' in navigator) || typeof caches === 'undefined') {
    r.supported = false
    return done()
  }
  r.supported = true
  try {
    await navigator.serviceWorker.register('${WORKER_PATH}', { scope: '/' })
    await navigator.serviceWorker.ready
    r.ours = 'registered'
  } catch (e) { r.ours = 'refused' }
  try {
    await navigator.serviceWorker.register('/author-sw.js', { scope: '/author/' })
    r.author = 'registered'
  } catch (e) { r.author = 'refused' }
  r.controlled = !!navigator.serviceWorker.controller
  done()
})().catch(() => parent.postMessage({ probe: { supported: false } }, '*'))
</script>`

type Origin = 'up' | 'down' | '503'
let server: Server
let port = 0
let frameState: Origin = 'up'
let policy = (): string => ''

beforeAll(async () => {
  server = createServer((request, response) => {
    const host = (request.headers.host ?? '').split(':')[0] ?? ''
    if (!host.startsWith('d-')) {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      return void response.end(
        `<!doctype html><iframe sandbox="${FRAME_SANDBOX}" src="http://d-abc.localhost:${port}/"></iframe>
        <script>addEventListener('message', (e) => { window.__probe = e.data.probe })</script>`,
      )
    }
    if (frameState === 'down') return void request.socket.destroy()
    if (frameState === '503') {
      response.writeHead(503, { 'Content-Type': 'text/plain' })
      return void response.end('Under maintenance')
    }
    if (request.url === WORKER_PATH) {
      response.writeHead(200, {
        'Content-Type': 'text/javascript',
        'Service-Worker-Allowed': '/',
      })
      return void response.end(WORKER)
    }
    if (request.url === '/author-sw.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' })
      return void response.end('')
    }
    response.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': policy(),
    })
    response.end(FRAME)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  port = typeof address === 'object' && address ? address.port : 0
})
afterAll(() => server.close())

const frameOf = (page: Page) =>
  page.frames().find((f) => f !== page.mainFrame())

const probeOf = async (page: Page) => {
  await page.waitForFunction(() => '__probe' in window, null, {
    timeout: 15_000,
  })
  return page.evaluate(
    () => (window as unknown as { __probe: Record<string, unknown> }).__probe,
  )
}

const openTop = async (
  launch: Parameters<typeof engine.launch>[0] | null,
  use: (page: Page) => Promise<void>,
) => {
  const browser = launch
    ? await engine.launch(launch)
    : await openTestBrowser(engine)
  try {
    const page = await (await browser.newContext()).newPage()
    await page.goto(`http://localhost:${port}/`)
    await use(page)
  } finally {
    await browser.close()
  }
}

const ours = () =>
  `sandbox allow-scripts allow-same-origin; worker-src http://d-abc.localhost:${port}${WORKER_PATH}; frame-ancestors *`

test("D-95: Given the version frame and a policy that names only the service worker, When the frame registers ours and the author's, Then only ours is registered and it controls the frame after a reload", async () => {
  policy = ours
  frameState = 'up'
  await openTop(null, async (page) => {
    expect(await probeOf(page)).toMatchObject({
      supported: true,
      ours: 'registered',
      author: 'refused',
      controlled: false,
    })
    await page.reload()
    expect(await probeOf(page)).toMatchObject({ controlled: true })
  })
})

test('D-95: Given a version the worker has seen, When the origin does not answer or answers 503, Then the frame still shows the stored page', async () => {
  policy = ours
  frameState = 'up'
  await openTop(null, async (page) => {
    await probeOf(page)
    await page.reload()
    await probeOf(page)
    for (const state of ['down', '503'] as const) {
      frameState = state
      await page.reload()
      await expect
        .poll(() => frameOf(page)?.locator('#hello').textContent())
        .toBe('frame live')
    }
    frameState = 'up'
  })
})

test('D-95: Given the policy of today, worker-src none, When the frame registers a worker, Then the browser refuses it', async () => {
  policy = () =>
    `sandbox allow-scripts allow-same-origin; worker-src 'none'; frame-ancestors *`
  frameState = 'up'
  await openTop(null, async (page) => {
    expect(await probeOf(page)).toMatchObject({
      supported: true,
      ours: 'refused',
      author: 'refused',
    })
  })
})

test.skipIf(engineName !== 'firefox')(
  'D-95: Given a Firefox that blocks every third-party cookie, When the frame looks for workers, Then it registers none and the page does not fail',
  async () => {
    policy = ours
    frameState = 'up'
    await openTop(
      { firefoxUserPrefs: { 'network.cookie.cookieBehavior': 1 } },
      async (page) => {
        // The registration is refused, or the frame reports no support.
        const result = await page
          .waitForFunction(() => '__probe' in window, null, { timeout: 5000 })
          .then(() =>
            page.evaluate(
              () =>
                (window as unknown as { __probe: { ours?: string } }).__probe,
            ),
          )
          .catch(() => ({}) as { ours?: string })
        expect(result.ours).not.toBe('registered')
      },
    )
  },
)
