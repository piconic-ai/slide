import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type Frame,
  type BrowserContext,
  type Request as PlaywrightRequest,
} from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
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

type Seen = {
  url: string
  cookie: string | null
  status: number
  /** The frame that made the request, and the frame around it. */
  frame: string
  parent: string | null
}

const siteOf = (url: URL) => url.hostname.split('.').slice(-2).join('.')

/** Frames that have been answered a navigation. */
const moved = new WeakSet<Frame>()

/** The page whose request this is: who the Fetch Metadata speaks of. */
function initiatorOf(request: PlaywrightRequest, wasMoved: boolean) {
  const frame = request.frame()
  if (!request.isNavigationRequest()) return frame.url()
  // A navigation is made by the reader (a top frame), by a frame that
  // already holds a document of ours and moves itself (a page that refreshes
  // or redirects), or by the page around a frame not yet loaded.
  // A form the page posts is made by that page; an address is the reader's.
  if (!frame.parentFrame())
    return request.method() === 'POST' ? frame.url() : undefined
  return wasMoved ? frame.url() : frame.parentFrame()?.url()
}

const siteRelation = (from: URL | null, target: URL) => {
  if (!from) return 'none'
  if (from.origin === target.origin) return 'same-origin'
  return siteOf(from) === siteOf(target) ? 'same-site' : 'cross-site'
}

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
  const frame = request.frame()
  const navigation = request.isNavigationRequest()
  const initiator = initiatorOf(request, moved.has(frame))
  if (navigation) moved.add(frame)
  const from = initiator ? new URL(initiator) : null
  const dest = frame.parentFrame() ? 'iframe' : 'document'
  return {
    ...headers,
    'sec-fetch-site': siteRelation(from, new URL(request.url())),
    'sec-fetch-mode': navigation ? 'navigate' : 'no-cors',
    'sec-fetch-dest': navigation ? dest : request.resourceType(),
  }
}

const postBody = (request: PlaywrightRequest) => {
  const data = request.postDataBuffer()
  return data ? new Uint8Array(data) : null
}

/** Set by a test of a cookie the browser has dropped by now. */
let dropRequestCookies = false

/** Set by a test of a browser that keeps no cookie a response sets. */
let dropCookies = false

/** Pages of other sites, which the Worker does not serve, by URL. */
const staticPages = new Map<string, string>()

/** A context answered by the Worker. */
async function withOwnerContext(
  use: (context: BrowserContext, seen: Seen[]) => Promise<void>,
) {
  const context = await browser.newContext()
  try {
    const seen: Seen[] = []
    await context.route('**/*', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const page = staticPages.get(url.href)
      if (page !== undefined) {
        seen.push({
          url: url.href,
          cookie: null,
          status: 200,
          frame: request.frame().url(),
          parent: request.frame().parentFrame()?.url() ?? null,
        })
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: page,
        })
      }
      if (
        url.hostname !== 'slide.example' &&
        !url.hostname.endsWith('.content.example')
      )
        return route.abort()
      const headers = await forwardedHeaders(request)
      if (dropRequestCookies && url.hostname.endsWith('.content.example'))
        delete headers.cookie
      const response = await server.fetch(
        new Request(url, {
          method: request.method(),
          headers,
          body: postBody(request),
        }),
        env,
      )
      seen.push({
        url: url.href,
        cookie: headers.cookie ?? null,
        status: response.status,
        frame: request.frame().url(),
        parent: request.frame().parentFrame()?.url() ?? null,
      })
      const out = Object.fromEntries(response.headers)
      if (dropCookies) delete out['set-cookie']
      await route.fulfill({
        status: response.status,
        headers: out,
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
      // The title is drawn before the script it loads has been asked for.
      await expect
        .poll(() => secretRequests(seen).map((request) => request.status))
        .toEqual([200])
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
      // What the other decks asked for, not what the draft's own frame, left
      // behind on the page before, was still loading.
      const others = [originOf(thiefId), originOf(reacherId)]
      const reached = fromDraft(seen).filter((request) =>
        others.some(
          (origin) =>
            request.frame.startsWith(origin) ||
            request.parent?.startsWith(origin),
        ),
      )
      expect(reached.length).toBeGreaterThan(0)
      for (const request of reached) expect(request.status).not.toBe(200)
    })
  },
  45000,
)

/** The launch the viewer would post for the draft, as a page of its own. */
async function launchForm(frameName: string) {
  const viewer = await server.fetch(
    new Request(`${TEST_ORIGIN}/@owner/private`, {
      headers: { Cookie: ownerLogin },
    }),
    env,
  )
  const html = await viewer.text()
  const action = /<form[^>]*?action="([^"]+)"[^>]*?data-launch/.exec(html)?.[1]
  const token = /name="token" value="([^"]+)"/.exec(html)?.[1]
  return `<iframe name="${frameName}" width="400" height="200"></iframe>
    <form method="post" action="${(action ?? '').replaceAll('&amp;', '&')}" target="${frameName}">
      <input type="hidden" name="token" value="${token}">
    </form><script>document.forms[0].submit()</script>`
}

test.skipIf(engineName === 'webkit')(
  'F02-AC24: Given a page of another site that frames the draft, When the owner has the draft open in the viewer, Then no session reaches it and nothing is shown',
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
      staticPages.set(
        'https://m.example/',
        `<iframe src="${originOf(privateId)}/"></iframe>`,
      )
      await page.goto('https://m.example/')
      await page.waitForTimeout(2000)
      // What the other site's frame asked for, not what the viewer's own
      // frame was still loading as the page was left.
      const framed = fromDraft(seen).filter(
        (request) =>
          request.parent === 'https://m.example/' ||
          request.frame.startsWith('https://m.example'),
      )
      expect(framed.length).toBeGreaterThan(0)
      for (const request of framed) {
        // Playwright keeps a cookie a fulfilled response sets without its
        // partition, which no browser does, so only Firefox shows that the
        // other site has no session. Chromium still refuses by Fetch
        // Metadata: the answer is not the draft.
        if (engineName === 'firefox') expect(request.cookie).toBeNull()
        expect(request.status).not.toBe(200)
      }
    })
  },
  45000,
)

test.skipIf(engineName === 'webkit')(
  'F02-AC24: Given one page with the draft in one frame and another deck in another, When that deck reaches for the draft by script, fetch, frame and image, Then only the draft’s own frame is answered with it',
  async () => {
    await withSignedInContext(async (context, seen) => {
      const form = await launchForm('draft-frame')
      staticPages.set(
        `${TEST_ORIGIN}/__both`,
        `${form}<iframe src="${originOf(reacherId)}/"></iframe>`,
      )
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/__both`)
      await expect
        .poll(
          () =>
            page
              .frame({ name: 'draft-frame' })
              ?.locator('#title')
              .textContent() ?? null,
          { timeout: 15000 },
        )
        .toBe('Draft')
      await page.waitForTimeout(2000)
      const theirs = fromDraft(seen).filter(
        (request) =>
          request.frame.startsWith(originOf(reacherId)) ||
          request.parent?.startsWith(originOf(reacherId)),
      )
      expect(theirs.length).toBeGreaterThan(0)
      for (const request of theirs) expect(request.status).not.toBe(200)
    })
  },
  45000,
)

test.skipIf(engineName === 'webkit')(
  'F02-AC24: Given another deck whose frame is sent through another site to the draft, When it arrives, Then the session does not count and the draft is not shown',
  async () => {
    await withSignedInContext(async (context, seen) => {
      const form = await launchForm('draft-frame')
      staticPages.set(
        'https://evil.example/hop',
        `<script>location.replace('${originOf(privateId)}/')</script>`,
      )
      staticPages.set(
        `${TEST_ORIGIN}/__hop`,
        `${form}<iframe name="hopper" src="${TEST_ORIGIN}/__hopper"></iframe>`,
      )
      staticPages.set(
        `${TEST_ORIGIN}/__hopper`,
        '<script>location.href = "https://evil.example/hop"</script>',
      )
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/__hop`)
      await expect
        .poll(
          () =>
            page
              .frame({ name: 'draft-frame' })
              ?.locator('#title')
              .textContent() ?? null,
          { timeout: 15000 },
        )
        .toBe('Draft')
      await page.waitForTimeout(2500)
      expect(
        await page.frame({ name: 'hopper' })?.locator('#title').count(),
      ).toBe(0)
    })
  },
  45000,
)

test.skipIf(engineName === 'webkit')(
  'F02-AC48: Given a browser that keeps no cookie the launch sets, When the owner opens the draft in the viewer, Then the viewer says it cannot show it here and offers a tab of its own',
  async () => {
    dropCookies = true
    try {
      await withSignedInContext(async (context) => {
        const page = await context.newPage()
        await page.goto(`${TEST_ORIGIN}/@owner/private`)
        const notice = page.locator('[data-preview-unavailable]')
        await expect
          .poll(() => notice.isVisible(), { timeout: 15000 })
          .toBe(true)
        expect(
          await notice.locator('[data-reason="unsupported"]').isVisible(),
        ).toBe(true)
        expect(
          await notice.locator('[data-reason="expired"]').isVisible(),
        ).toBe(false)
      })
    } finally {
      dropCookies = false
    }
  },
  45000,
)

test.skipIf(engineName === 'webkit')(
  'F02-AC24: Given a deck on a site of the same registrable domain as the draft, When its frame is sent through another site to the draft, Then the draft is not shown',
  async () => {
    await withSignedInContext(async (context) => {
      const form = await launchForm('draft-frame')
      staticPages.set(
        'https://evil.example/hop2',
        `<script>location.replace('${originOf(privateId)}/')</script>`,
      )
      staticPages.set(
        `${originOf(reacherId)}/__hop`,
        '<script>location.href = "https://evil.example/hop2"</script>',
      )
      staticPages.set(
        `${TEST_ORIGIN}/__hop2`,
        `${form}<iframe name="hopper" src="${originOf(reacherId)}/__hop"></iframe>`,
      )
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/__hop2`)
      await expect
        .poll(
          () =>
            page
              .frame({ name: 'draft-frame' })
              ?.locator('#title')
              .textContent() ?? null,
          { timeout: 15000 },
        )
        .toBe('Draft')
      await page.waitForTimeout(2500)
      expect(
        await page.frame({ name: 'hopper' })?.locator('#title').count(),
      ).toBe(0)
    })
  },
  45000,
)

test.skipIf(engineName === 'webkit')(
  'F02-AC48: Given the draft open in the viewer for more than five minutes, When its frame goes to another page and finds no cookie, Then the viewer says the time ran out, not that the browser cannot',
  async () => {
    await withSignedInContext(async (context) => {
      const page = await context.newPage()
      await page.clock.install()
      await page.goto(`${TEST_ORIGIN}/@owner/private`)
      await expect
        .poll(
          () =>
            page.frameLocator('iframe#deck').locator('#title').textContent(),
          { timeout: 15000 },
        )
        .toBe('Draft')
      await page.clock.fastForward('06:00')
      dropRequestCookies = true
      const frame = page
        .frames()
        .find((candidate) => candidate.url().startsWith(originOf(privateId)))
      await frame?.evaluate('location.reload()')
      const notice = page.locator('[data-preview-unavailable]')
      await expect.poll(() => notice.isVisible(), { timeout: 15000 }).toBe(true)
      expect(await notice.locator('[data-reason="expired"]').isVisible()).toBe(
        true,
      )
      expect(
        await notice.locator('[data-reason="unsupported"]').isVisible(),
      ).toBe(false)
      dropRequestCookies = false
    })
  },
  45000,
)

test.skipIf(engineName === 'webkit')(
  'F02-AC22: Given the owner’s viewer of a draft, When they press "公開する" in the notice, Then the form is sent (the viewer’s policy lets it) and the slides become public',
  async () => {
    await seedDeck(db, 'pressed')
    await seedDeployment(db, 'pressed')
    await withSignedInContext(async (context, seen) => {
      const page = await context.newPage()
      await page.goto(`${TEST_ORIGIN}/@owner/pressed`)
      // The page speaks the browser's language: find the button by its mark.
      await page.locator('.viewer-notice button[data-once]').click()
      await expect
        .poll(
          () =>
            seen.some(
              (request) =>
                request.url === `${TEST_ORIGIN}/slides/pressed/publication`,
            ),
          { timeout: 15000 },
        )
        .toBe(true)
      expect(
        seen.find(
          (request) =>
            request.url === `${TEST_ORIGIN}/slides/pressed/publication`,
        )?.status,
      ).toBe(303)
      const row = await db
        .prepare(
          "SELECT public_deployment_id AS id FROM decks WHERE id = 'pressed'",
        )
        .first<{ id: string | null }>()
      expect(row?.id).not.toBeNull()
    })
  },
  45000,
)
