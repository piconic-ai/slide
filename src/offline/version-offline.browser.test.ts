import { createServer, type Server } from 'node:http'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import {
  chromium,
  firefox,
  webkit,
  type BrowserContext,
  type Frame,
  type Page,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { decks, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  seedDeployment,
  seedPublic,
  signIn,
  testEnv,
} from '../publication/test-support'
import { openTestBrowser } from '../test-open-browser'
import { OFFLINE_MESSAGE, STORED_AT_HEADER, VERSION_CACHE } from './limits'

/**
 * A version's worker, in a real browser, against the real Worker over real
 * HTTP (a Service Worker's own requests do not go through Playwright's
 * routes). Run with BROWSER=chromium, firefox or webkit. The viewer's own
 * script comes in a later part; here the test asks the frame to keep the
 * version, as the viewer will.
 */
const engineName = process.env.BROWSER ?? 'chromium'
const engine = { chromium, firefox, webkit }[engineName]
if (!engine) throw new Error(`Unknown BROWSER: ${engineName}`)
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)

type Down = 'up' | 'down' | number
/** How each version's origin answers, by deployment id; the service is up unless the test says. */
const states = new Map<string, Down>()
let http: Server
let port = 0
let env: Env

const index = (heading: string) =>
  `<!doctype html><html><head><title>${heading}</title></head><body><h1 id="title">${heading}</h1><img src="img/dot.svg" id="dot"></body></html>`
const FILES = (heading: string): Record<string, [string, string]> => ({
  'index.html': ['text/html; charset=utf-8', index(heading)],
  'img/dot.svg': [
    'image/svg+xml',
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>',
  ],
  // A file an author may name the way the service names its worker.
  '_preview/sw.js': ['text/javascript', 'throw new Error("author file")'],
  'sw.js': ['text/javascript', 'self.addEventListener("fetch", () => {})'],
})

async function putFiles(id: string, files: Record<string, [string, string]>) {
  for (const [at, [path, [type, body]]] of Object.entries(files).entries()) {
    const key = `${id}/${at}/lease`
    await platform.env.UPLOADS.put(key, body)
    const digest = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)),
    ).toString('hex')
    await orm.insert(uploadFiles).values({
      deployment_id: id,
      id: String(at),
      path,
      size: body.length,
      sha256: digest,
      media_type: type,
      object_key: key,
    })
  }
}

let first = ''
let second = ''
beforeAll(async () => {
  http = createServer(async (request, response) => {
    const host = request.headers.host ?? ''
    const url = `http://${host}${request.url}`
    const id = /^d-([^.]+)\./.exec(host)?.[1]
    const state = (id && states.get(id)) || 'up'
    if (state === 'down') return void request.socket.destroy()
    if (typeof state === 'number') {
      response.writeHead(state, {
        'Content-Type': 'text/plain',
        ...(state === 503
          ? {
              'Retry-After': '300',
              'X-Slide-Intended': 'maintenance',
              'X-Slide-Maintenance': 'on',
            }
          : {}),
      })
      return void response.end(`status ${state}`)
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers))
      if (value !== undefined) headers.set(name, String(value))
    const answer = await server.fetch(
      new Request(url, {
        method: request.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        redirect: 'manual',
      }),
      env,
    )
    response.writeHead(answer.status, Object.fromEntries(answer.headers))
    response.end(Buffer.from(await answer.arrayBuffer()))
  })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  const address = http.address()
  port = typeof address === 'object' && address ? address.port : 0
  env = {
    ...testEnv(platform.env),
    PUBLIC_ORIGIN: `http://localhost:${port}`,
    CONTENT_ORIGIN: `http://localhost:${port}`,
  } as unknown as Env
  await applyMigrations(db)
  // Makes the author, whose handle the share URLs name.
  await signIn(env)
  first = await seedPublic(db, 'talk', 1, 'Talk')
  await putFiles(first, FILES('First'))
  // The same deck's next public version, for the replaced case.
  second = (await seedPublic(db, 'other', 2, 'Other')) as string
  await putFiles(second, FILES('Second'))
})
afterAll(async () => {
  http?.close()
  await platform.dispose()
})
beforeEach(() => states.clear())

const viewer = (slug = 'talk') => `http://localhost:${port}/@owner/${slug}`
const origin = (id: string) => `http://d-${id}.localhost:${port}`

type Seen = {
  origin: string
  data: { type: string; state?: string; at?: number }
}

async function openViewer(context: BrowserContext, slug = 'talk') {
  const page = await context.newPage()
  await page.addInitScript(() => {
    const seen: unknown[] = []
    ;(window as unknown as { __seen: unknown[] }).__seen = seen
    addEventListener('message', (event) =>
      seen.push({ origin: event.origin, data: event.data }),
    )
  })
  await page.goto(viewer(slug))
  return page
}

const seenOf = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __seen: unknown[] }).__seen,
  ) as Promise<Seen[]>

const deckFrame = async (page: Page, id: string) => {
  await expect
    .poll(() => page.frames().some((f) => f.url().startsWith(origin(id))), {
      timeout: 20_000,
    })
    .toBe(true)
  return page.frames().find((f) => f.url().startsWith(origin(id))) as Frame
}

/** What the viewer will do once its script exists: ask the frame to keep the version. */
async function askToKeep(page: Page, id: string) {
  await deckFrame(page, id)
  await page.evaluate(
    ([target, type]) => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe#deck')
      frame?.contentWindow?.postMessage({ type }, target as string)
    },
    [origin(id), OFFLINE_MESSAGE.register],
  )
  await expect
    .poll(async () =>
      (await seenOf(page)).find((m) => m.data.type === OFFLINE_MESSAGE.state),
    )
    .toBeTruthy()
  return (await seenOf(page)).find((m) => m.data.type === OFFLINE_MESSAGE.state)
}

const withContext = async (use: (context: BrowserContext) => Promise<void>) => {
  const browser = await openTestBrowser(engine)
  try {
    await use(await browser.newContext())
  } finally {
    await browser.close()
  }
}

const titleOf = async (page: Page, id: string) => {
  const frame = await deckFrame(page, id)
  return frame.locator('#title').textContent({ timeout: 10_000 })
}

/** The version, opened once online and kept, then opened again so its worker is in charge. */
async function openAndKeep(context: BrowserContext, id = first, slug = 'talk') {
  const page = await openViewer(context, slug)
  expect(await titleOf(page, id)).toBe(
    'First'.replace('First', id === first ? 'First' : 'Second'),
  )
  const kept = await askToKeep(page, id)
  expect(kept?.origin).toBe(origin(id))
  expect(kept?.data.state).toBe('stored')
  return page
}

test('F37-AC1, AC2, AC5: Given a version kept once, When it is opened while its origin does not answer, Then the stored page is shown and tells the viewer it is stored; online, nothing says so', async () => {
  await withContext(async (context) => {
    const page = await openAndKeep(context)
    await page.reload()
    expect(await titleOf(page, first)).toBe('First')
    // Online: the service's own answer, and no word of a stored copy.
    expect(
      (await seenOf(page)).some((m) => m.data.type === OFFLINE_MESSAGE.stored),
    ).toBe(false)
    states.set(first, 'down')
    await page.reload()
    expect(await titleOf(page, first)).toBe('First')
    await expect
      .poll(async () =>
        (await seenOf(page)).find(
          (m) => m.data.type === OFFLINE_MESSAGE.stored,
        ),
      )
      .toMatchObject({ origin: origin(first) })
    const told = (await seenOf(page)).find(
      (m) => m.data.type === OFFLINE_MESSAGE.stored,
    )
    expect(told?.data.at).toBeGreaterThan(Date.now() - 60_000)
    // The file the page loads is stored too.
    const frame = await deckFrame(page, first)
    await expect
      .poll(() =>
        frame
          .locator('#dot')
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(4)
  })
})

test.each([
  ['F37-AC3', 429],
  ['F37-AC4', 503],
  ['F37-AC4 (500)', 500],
])(
  '%s: Given a kept version, When its origin answers %i, Then the stored page is shown',
  async (_, status) => {
    await withContext(async (context) => {
      const page = await openAndKeep(context)
      await page.reload()
      await titleOf(page, first)
      states.set(first, status)
      await page.reload()
      expect(await titleOf(page, first)).toBe('First')
      await expect
        .poll(async () =>
          (await seenOf(page)).some(
            (m) => m.data.type === OFFLINE_MESSAGE.stored,
          ),
        )
        .toBe(true)
    })
  },
)

test.each([
  ['F37-AC7', 404],
  ['F37-AC8', 410],
  ['F37-AC9', 403],
])(
  '%s: Given a kept version, When its origin answers %i, Then the stored files are gone and no stored page is shown after',
  async (_, status) => {
    await withContext(async (context) => {
      const page = await openAndKeep(context)
      await page.reload()
      await titleOf(page, first)
      states.set(first, status)
      await page.reload()
      const frame = await deckFrame(page, first)
      await expect
        .poll(() => frame.locator('body').textContent())
        .toContain(`status ${status}`)
      await expect
        .poll(() => frame.evaluate(() => caches.keys()))
        .not.toContain(VERSION_CACHE)
      states.set(first, 'down')
      await page.reload()
      // Nothing stored stands in: the frame is the browser's error page.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const after = page.frames().find((f) => f.url().startsWith(origin(first)))
      expect(await after?.locator('#title').count()).toBeFalsy()
      expect(
        (await seenOf(page)).some(
          (m) => m.data.type === OFFLINE_MESSAGE.stored,
        ),
      ).toBe(false)
    })
  },
)

test('F37-AC10: Given a version kept more than a day ago, When its origin does not answer, Then no stored page is shown', async () => {
  await withContext(async (context) => {
    const page = await openAndKeep(context)
    await page.reload()
    const frame = await deckFrame(page, first)
    // Age every kept file, as a day of the reader's absence would.
    await frame.evaluate(
      async ([name, header]) => {
        const cache = await caches.open(name as string)
        for (const key of await cache.keys()) {
          const entry = await cache.match(key)
          if (!entry) continue
          const headers = new Headers(entry.headers)
          headers.set(header as string, String(Date.now() - 86_400_000 - 1000))
          await cache.put(key, new Response(await entry.blob(), { headers }))
        }
      },
      [VERSION_CACHE, STORED_AT_HEADER],
    )
    states.set(first, 'down')
    await page.reload()
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const after = page.frames().find((f) => f.url().startsWith(origin(first)))
    expect(await after?.locator('#title').count()).toBeFalsy()
  })
})

test('F37-AC12: Given a version never opened, When its origin does not answer, Then nothing stands in', async () => {
  await withContext(async (context) => {
    states.set(second, 'down')
    const page = await openViewer(context, 'other')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const frame = page.frames().find((f) => f.url().startsWith(origin(second)))
    expect(await frame?.locator('#title').count()).toBeFalsy()
  })
})

test('F37-AC5: Given a kept version, When the deck is given a new public version, Then the viewer opens the new one', async () => {
  await withContext(async (context) => {
    const page = await openAndKeep(context)
    await page.reload()
    const next = await seedDeployment(db, 'talk')
    await putFiles(next, FILES('Second'))
    await orm
      .update(decks)
      .set({ public_deployment_id: next })
      .where(eq(decks.id, 'talk'))
    await page.reload()
    expect(await titleOf(page, next)).toBe('Second')
    await orm
      .update(decks)
      .set({ public_deployment_id: first })
      .where(eq(decks.id, 'talk'))
  })
})

test("F37-AC18, AC19: Given a version, Then an author file named like the worker cannot be fetched, the worker is the service's, and a worker of the author is refused", async () => {
  await withContext(async (context) => {
    const page = await context.newPage()
    const shadow = await page.request.get(`${origin(first)}/_preview/sw.js`)
    expect(shadow.status()).toBe(200)
    expect(await shadow.text()).not.toContain('author file')
    expect(shadow.headers()['service-worker-allowed']).toBe('/')
    expect(shadow.headers()['content-type']).toMatch(/javascript/)
    // The author's own worker is refused by the policy; the service's is not.
    await page.goto(`${origin(first)}/img/dot.svg`)
    const registered = (path: string) =>
      page.evaluate(
        (script) =>
          navigator.serviceWorker.register(script, { scope: '/' }).then(
            () => 'registered',
            () => 'refused',
          ),
        path,
      )
    expect(await registered('/sw.js')).toBe('refused')
    expect(await registered('/_preview/sw.js')).toBe('registered')
  })
})

test('F37-AC17: Given a top page the service could not put its script in, When the frame is asked to keep it, Then it says it cannot and keeps nothing', async () => {
  await withContext(async (context) => {
    const piece = await seedPublic(db, 'piece', 3, 'Piece')
    await putFiles(piece, {
      'index.html': [
        'text/html; charset=utf-8',
        '<h1 id="title">a piece of html</h1>',
      ],
    })
    const page = await openViewer(context, 'piece')
    await titleOf(page, piece)
    // No script was put in, so the frame cannot answer the viewer's question.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(
      (await seenOf(page)).some((m) => m.data.type === OFFLINE_MESSAGE.state),
    ).toBe(false)
    const kept = await (
      await deckFrame(page, piece)
    ).evaluate(() => globalThis.caches.keys())
    expect(kept).toEqual([])
  })
})
