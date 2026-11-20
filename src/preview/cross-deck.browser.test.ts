import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Request as PlaywrightRequest,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

/**
 * The browser engine, chosen with BROWSER. WebKit is left out: Playwright
 * does not show its interceptor the cookies WebKit attaches, so the Worker
 * here would never see the owner's session, whatever WebKit decided.
 */
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

const originOf = (id: string) => `https://d-${id}.content.example`

let browser: Browser
/** A draft only its owner may open, and the cookie of the owner's session. */
let privateId = ''
let ownerSession = ''
/** The owner's sign-in cookie on the management origin. */
let ownerLogin = ''
/** A public deck that reaches for the draft by fetch, frame and image. */
let reacherId = ''
/** A public deck that pulls the draft's script into its own page. */
let thiefId = ''

async function putFiles(id: string, files: Record<string, [string, string]>) {
  for (const [index, [path, [type, body]]] of Object.entries(files).entries()) {
    const key = `${id}/${index}/lease`
    await platform.env.UPLOADS.put(key, body)
    await orm.insert(uploadFiles).values({
      deployment_id: id,
      id: String(index),
      path,
      size: body.length,
      sha256: 'f'.repeat(63) + index,
      media_type: type,
      object_key: key,
    })
  }
}

/** Opens an owner-only session for the draft; returns its cookie. */
async function openAsOwner(owner: string, id: string) {
  const page = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/private/deployments/${id}/preview`, {
      method: 'POST',
      headers: { Cookie: owner, Origin: TEST_ORIGIN },
    }),
    env,
  )
  const token = /name="token" value="([^"]+)"/.exec(await page.text())?.[1]
  const launched = await server.fetch(
    new Request(`${originOf(id)}/_preview/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: token ?? '' }).toString(),
    }),
    env,
  )
  expect(launched.status).toBe(303)
  return launched.headers.getSetCookie()[0]?.split(';')[0] ?? ''
}

beforeAll(async () => {
  await applyMigrations(db)
  await resetTables(db)
  const owner = await signIn(env)
  ownerLogin = owner
  await seedDeck(db, 'private')
  privateId = await seedDeployment(db, 'private')
  await putFiles(privateId, {
    'index.html': [
      'text/html; charset=utf-8',
      '<h1 id="title">Draft</h1><script src="/js/secret.js"></script>',
    ],
    'js/secret.js': ['text/javascript', 'window.SECRET = "unreleased plan"'],
  })
  ownerSession = await openAsOwner(owner, privateId)
  thiefId = await seedPublic(db, 'thief', 1, 'thief')
  await putFiles(thiefId, {
    'index.html': [
      'text/html; charset=utf-8',
      `<script src="${originOf(privateId)}/js/secret.js"></script>
      <p id="got"></p>
      <script>
        addEventListener('load', () => {
          document.querySelector('#got').textContent = 'got:' + String(window.SECRET)
        })
      </script>`,
    ],
  })
  reacherId = await seedPublic(db, 'reacher', 1, 'reacher')
  const reach = originOf(privateId)
  await putFiles(reacherId, {
    'index.html': [
      'text/html; charset=utf-8',
      `<img src="${reach}/js/secret.js"><iframe src="${reach}/"></iframe>
      <script>
        fetch('${reach}/', { mode: 'no-cors', credentials: 'include' }).catch(() => {})
        fetch('${reach}/js/secret.js', { credentials: 'include' }).catch(() => {})
        addEventListener('load', () => (document.title = 'reached'))
      </script>`,
    ],
  })
  browser = await engine.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

type Seen = { url: string; cookie: string | null; status: number }

const siteOf = (url: URL) => url.hostname.split('.').slice(-2).join('.')

/**
 * The headers the Worker would receive. Firefox reports the Fetch Metadata
 * it sends. Chromium adds them after interception, so they are given the
 * values the network carries; the cookie is Chromium's own decision. The
 * values cover what these tests request (a page the reader opens, a frame,
 * a script), not every kind of request; Firefox is the engine that shows
 * what a browser really sends.
 */
async function forwardedHeaders(request: PlaywrightRequest) {
  const headers = await request.allHeaders()
  if ('sec-fetch-site' in headers) return headers
  const target = new URL(request.url())
  const frame = request.frame()
  const navigation = request.isNavigationRequest()
  // A navigation is made by the page that holds the frame, or by the reader.
  const initiator = navigation ? frame.parentFrame()?.url() : frame.url()
  const from = initiator ? new URL(initiator) : null
  const site = !from
    ? 'none'
    : from.origin === target.origin
      ? 'same-origin'
      : siteOf(from) === siteOf(target)
        ? 'same-site'
        : 'cross-site'
  return {
    ...headers,
    'sec-fetch-site': site,
    'sec-fetch-mode': navigation ? 'navigate' : 'no-cors',
    'sec-fetch-dest': navigation
      ? frame.parentFrame()
        ? 'iframe'
        : 'document'
      : request.resourceType(),
  }
}

const postBody = (request: PlaywrightRequest) => {
  const data = request.postDataBuffer()
  return data ? new Uint8Array(data) : null
}

/** A context where the owner has the draft open, answered by the Worker. */
async function withOwnerContext(
  use: (context: BrowserContext, seen: Seen[]) => Promise<void>,
) {
  const context = await browser.newContext()
  try {
    const [name, value] = ownerSession.split('=')
    await context.addCookies([
      {
        name: name ?? '',
        value: value ?? '',
        url: originOf(privateId),
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])
    const seen: Seen[] = []
    await context.route('**/*', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (
        url.hostname !== 'slide.example' &&
        !url.hostname.endsWith('.content.example')
      )
        return route.abort()
      const headers = await forwardedHeaders(request)
      let response = await server.fetch(
        new Request(url, {
          method: request.method(),
          headers,
          body: postBody(request),
        }),
        env,
      )
      const set = response.headers.getSetCookie()
      const location = response.headers.get('location')
      seen.push({
        url: url.href,
        cookie: headers.cookie ?? null,
        status: response.status,
      })
      if (response.status === 303 && location) {
        // Playwright does not route the request a fulfilled redirect asks
        // for, so the redirect is followed here, with the cookie it set,
        // and the browser gets the final answer plus the Set-Cookie.
        const next = new URL(location, url)
        const cookie = set.map((line) => line.split(';')[0]).join('; ')
        const followed = await server.fetch(
          new Request(next, {
            headers: {
              ...headers,
              cookie,
              'content-type': '',
              'content-length': '0',
            },
          }),
          env,
        )
        seen.push({ url: next.href, cookie, status: followed.status })
        const headersOut = new Headers(followed.headers)
        for (const line of set) headersOut.append('set-cookie', line)
        response = new Response(followed.body, {
          status: followed.status,
          headers: headersOut,
        })
      }
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      })
    })
    await use(context, seen)
  } finally {
    await context.close()
  }
}

/** A context where the owner is signed in on the management origin only. */
async function withSignedInContext(
  use: (context: BrowserContext, seen: Seen[]) => Promise<void>,
) {
  await withOwnerContext(async (context, seen) => {
    await context.clearCookies()
    const [name, value] = ownerLogin.split('=')
    await context.addCookies([
      {
        name: name ?? '',
        value: value ?? '',
        url: TEST_ORIGIN,
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])
    await use(context, seen)
  })
}

const secretRequests = (seen: Seen[]) =>
  seen.filter((request) => request.url.endsWith('/js/secret.js'))

test.skipIf(engineName === 'webkit')(
  'F17-AC1: Given an owner with their draft open, When they open the draft itself, Then its own script is served',
  async () => {
    await withOwnerContext(async (context, seen) => {
      const page = await context.newPage()
      await page.goto(`${originOf(privateId)}/`)
      await expect
        .poll(() => page.evaluate('window.SECRET'))
        .toBe('unreleased plan')
      expect(secretRequests(seen).map((request) => request.status)).toEqual([
        200,
      ])
    })
  },
  20000,
)

test.skipIf(engineName === 'webkit')(
  'F17-AC1: Given an owner with their draft open, When they open another deck at its own origin and that deck pulls in the draft’s script, Then the script is not served to it',
  async () => {
    await withOwnerContext(async (context, seen) => {
      const page = await context.newPage()
      await page.goto(`${originOf(thiefId)}/`)
      await expect
        .poll(() => page.locator('#got').textContent())
        .toBe('got:undefined')
      const requests = secretRequests(seen)
      expect(requests).not.toHaveLength(0)
      for (const request of requests) expect(request.status).not.toBe(200)
    })
  },
  20000,
)

test.skipIf(engineName === 'webkit')(
  'F17-AC1: Given an owner with their draft open, When they read another deck in the viewer and that deck pulls in the draft’s script, Then the script is not served to it',
  async () => {
    await withOwnerContext(async (context, seen) => {
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/@owner/thief`)
      await expect
        .poll(() => page.frameLocator('iframe').locator('#got').textContent())
        .toBe('got:undefined')
      // Inside the viewer the browser sends no session cookie at all, so
      // this held before the session was narrowed; it stays as a guard.
      const requests = secretRequests(seen)
      expect(requests).not.toHaveLength(0)
      for (const request of requests) expect(request.status).not.toBe(200)
    })
  },
  20000,
)

const fromDraft = (seen: Seen[]) =>
  seen.filter((request) => request.url.startsWith(originOf(privateId)))

test.skipIf(engineName === 'webkit')(
  'F02-AC18: Given an owner with a draft, When they open its viewer, Then the draft shows in the frame, its own script runs, and no token is in any URL',
  async () => {
    await withSignedInContext(async (context, seen) => {
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/@owner/private`)
      const frame = page.frameLocator('iframe#deck')
      await expect
        .poll(() => frame.locator('#title').textContent(), { timeout: 15000 })
        .toBe('Draft')
      expect(secretRequests(seen).map((request) => request.status)).toEqual([
        200,
      ])
      for (const request of seen) {
        expect(request.url).not.toMatch(/token=|[A-Za-z0-9_-]{43}/)
      }
      expect(page.url()).toBe(`${TEST_ORIGIN}/@owner/private`)
    })
  },
  30000,
)

test.skipIf(engineName === 'webkit')(
  'F02-AC24: Given an owner whose draft is open in the viewer, When another deck in the viewer reaches for the draft by script, fetch, frame and image, Then no request is answered with the draft',
  async () => {
    await withSignedInContext(async (context, seen) => {
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/@owner/private`)
      await expect
        .poll(
          () =>
            page.frameLocator('iframe#deck').locator('#title').textContent(),
          { timeout: 15000 },
        )
        .toBe('Draft')
      seen.length = 0
      for (const path of ['/@owner/thief', '/@owner/reacher']) {
        await page.goto(`${TEST_ORIGIN}${path}`)
        await page.waitForTimeout(2000)
      }
      const reached = fromDraft(seen)
      expect(reached.length).toBeGreaterThan(0)
      for (const request of reached) expect(request.status).not.toBe(200)
    })
  },
  45000,
)
