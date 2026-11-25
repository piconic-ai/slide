import { openTestBrowser } from '../test-open-browser'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import type { Browser, BrowserContext, Page, Route } from 'playwright'
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

// The top page and the router are built by `pnpm build`; CI builds first.
const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
/** A limiter that lets everything through: these tests make many requests. */
const open_ = { limit: async () => ({ success: true }) }
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  AUTH_RATE_LIMITER: open_,
  UPLOAD_RATE_LIMITER: open_,
  MANAGEMENT_RATE_LIMITER: open_,
  VIEWER_RATE_LIMITER: open_,
  CONTENT_RATE_LIMITER: open_,
  PAGE_SHOT_RATE_LIMITER: open_,
} as unknown as Env

/** Pages answered with a change, by path: what a test needs to see. */
const rewrites = new Map<string, (html: string) => string>()

let secondId = ''
let draftId = ''
let browser: Browser

const SETTLE = { timeout: 10000 }

/** Slides that tell which page they show, as the viewer's tests do. */
const PAGED = `<!doctype html><title>paged</title><script src="/_preview/pages.js"></script>
  <button id="three" onclick="location.hash = '#3'">3</button>
  <button id="four" onclick="location.hash = '#4'">4</button>`

async function seedDeckPage(slug: string, readyAt: number, body: string) {
  const id = await seedPublic(db, slug, readyAt, `Deck ${slug}`)
  await storeIndex(id, body)
  return id
}

const originOf = (id: string) => `https://d-${id}.content.example`

/** Stores the one file of a version, as a finished upload would. */
async function storeIndex(id: string, body: string) {
  const key = `${id}/0/lease`
  await platform.env.UPLOADS.put(key, body)
  await orm.insert(uploadFiles).values({
    deployment_id: id,
    id: '0',
    path: 'index.html',
    size: body.length,
    sha256: 'a'.repeat(64),
    media_type: 'text/html; charset=utf-8',
    object_key: key,
  })
}

beforeAll(async () => {
  await applyMigrations(db)
  await resetTables(db)
  await seedDeck(db, 'unpublished')
  await signIn(env)
  await seedDeckPage('talk', 1, PAGED)
  secondId = await seedDeckPage('second', 2, PAGED)
  // Slides of an author who sends their own frame to the origin of another
  // deck: a public one, and a version that is only the author's.
  await seedDeck(db, 'draft')
  draftId = await seedDeployment(db, 'draft')
  await storeIndex(draftId, PAGED)
  await seedDeckPage(
    'wander',
    3,
    `<!doctype html><title>wander</title>
    <button id="public" onclick="location.href = '${originOf(secondId)}/'">public</button>
    <button id="draft" onclick="location.href = '${originOf(draftId)}/'">draft</button>`,
  )
  browser = await openTestBrowser()
})
afterEach(() => rewrites.clear())
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

const isServed = (url: URL) =>
  url.hostname === 'slide.example' || url.hostname.endsWith('.content.example')

/** Answers the browser's requests with the Worker, as Cloudflare would. */
async function answer(route: Route) {
  const request = route.request()
  const url = new URL(request.url())
  if (!isServed(url)) return route.abort()
  // Miniflare's local proxy refuses an Origin outside its own hostnames.
  const { origin: _origin, ...headers } = await request.allHeaders()
  if (
    request.method() === 'POST' &&
    url.origin === TEST_ORIGIN &&
    new URL(request.frame().url()).origin === TEST_ORIGIN
  )
    headers['sec-fetch-site'] = 'same-origin'
  const body = request.postDataBuffer()
  const response = await server.fetch(
    new Request(url, {
      method: request.method(),
      headers,
      body:
        body && request.method() !== 'GET' ? new Uint8Array(body) : undefined,
      redirect: 'manual',
    }),
    env,
  )
  const kept = Object.fromEntries(response.headers)
  const rewrite = rewrites.get(url.pathname)
  await route.fulfill({
    status: response.status,
    headers: kept,
    // An answer to a HEAD has no body, whatever the page it stands for.
    body:
      request.method() === 'HEAD'
        ? undefined
        : rewrite
          ? rewrite(await response.text())
          : Buffer.from(await response.arrayBuffer()),
  })
}

async function withPage(
  options: { signedIn?: boolean; viewport?: { width: number; height: number } },
  use: (page: Page, context: BrowserContext, errors: string[]) => Promise<void>,
) {
  const context = await browser.newContext({
    viewport: options.viewport,
    acceptDownloads: true,
  })
  try {
    if (options.signedIn !== false)
      await context.addCookies([
        {
          name: '__Host-slide_owner',
          // Signing out ends a session, so each page has its own.
          value: (await signIn(env)).split('=')[1] ?? '',
          url: TEST_ORIGIN,
          secure: true,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ])
    await context.route('**/*', answer)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('console', (message) => {
      // A refused resource is told by its response, below.
      if (
        message.type() === 'error' &&
        !message.text().startsWith('Failed to load resource')
      )
        errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', (response) => {
      // The covers of slides made for a test are not taken by the stand-in,
      // and a face answers 404 for a person with no picture, by design.
      if (
        response.status() >= 400 &&
        !response.url().includes('/covers/') &&
        !response.url().includes('/avatars/')
      )
        errors.push(`${response.request().method()} ${response.url()}`)
    })
    page.on('requestfailed', (request) => {
      // A request the page gave up on (a move made over another) is not a failure.
      if (request.failure()?.errorText !== 'net::ERR_ABORTED')
        errors.push(`failed ${request.url()}`)
    })
    try {
      await use(page, context, errors)
    } catch (error) {
      if (process.env.ROUTER_SHOTS) console.log(errors)
      if (process.env.ROUTER_SHOTS)
        await page
          .screenshot({ path: `${process.env.ROUTER_SHOTS}/failed.png` })
          .catch(() => {})
      throw error
    }
  } finally {
    await context.close()
  }
}

type Marked = Window &
  typeof globalThis & { __page?: number; __header?: Element | null }

/** Remembers this document and its header, to tell a move from a reload. */
const mark = (page: Page) =>
  page.evaluate(() => {
    const w = window as Marked
    w.__page = 1
    w.__header = document.querySelector('.site-header')
  })

/** Whether the document and the header are the ones that were marked. */
const kept = (page: Page) =>
  page.evaluate(() => {
    const w = window as Marked
    return {
      document: w.__page === 1,
      header:
        w.__header !== undefined &&
        w.__header === document.querySelector('.site-header'),
      navigations: performance.getEntriesByType('navigation').length,
    }
  })

const path = (page: Page) => new URL(page.url()).pathname

/** Presses a link and waits for the router to finish its move. */
async function follow(page: Page, selector: string) {
  await page.locator(selector).first().click()
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          document.documentElement.hasAttribute('data-bf-navigating'),
        ),
      SETTLE,
    )
    .toBe(false)
}

/** Opens the account menu in the header and presses one of its links. */
async function viaMenu(page: Page, href: string) {
  await page.locator('.site-header summary.avatar').click()
  await follow(page, `.site-header .menu-items a[href="${href}"]`)
}

async function waitForHeader(page: Page) {
  await expect
    .poll(() => page.locator('.site-header summary.avatar').count(), SETTLE)
    .toBe(1)
}

test('F03-AC49, F03-AC50: Given a signed-in author, When they move between the top page, the profile, the slides, a slide, settings and help by links, Then no page is loaded whole and the header is the same element throughout', async () => {
  await withPage({}, async (page, _context, errors) => {
    await page.goto(`${TEST_ORIGIN}/`)
    await waitForHeader(page)
    await mark(page)
    const walk: [string, () => Promise<void>][] = [
      ['/@owner', () => viaMenu(page, '/@owner')],
      ['/', () => follow(page, 'a.brand')],
      ['/slides', () => viaMenu(page, '/slides')],
      ['/slides/talk', () => follow(page, 'a[href="/slides/talk"]')],
      ['/settings', () => viaMenu(page, '/settings')],
      ['/help', () => follow(page, '.site-footer a[href="/help"]')],
    ]
    for (const [expected, move] of walk) {
      await move()
      await expect.poll(() => path(page), SETTLE).toBe(expected)
      expect(await kept(page)).toEqual({
        document: true,
        header: true,
        navigations: 1,
      })
    }
    expect(errors).toEqual([])
  })
}, 60000)

test('F03-AC73: Given a page that allows no form, When the reader moves to a page with forms, Then the page is loaded whole, so its forms are allowed by its own policy', async () => {
  await withPage({}, async (page) => {
    for (const [from, to] of [['/help', '/settings']] as const) {
      await page.goto(`${TEST_ORIGIN}${from}`)
      await waitForHeader(page)
      await mark(page)
      await page.locator('.site-header summary.avatar').click()
      const asked = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === to &&
          request.isNavigationRequest(),
      )
      await page.locator(`.site-header .menu-items a[href="${to}"]`).click()
      expect((await asked).isNavigationRequest()).toBe(true)
      await page.waitForURL(`${TEST_ORIGIN}${to}`)
      expect(
        await page.evaluate(() => (window as Marked).__page),
      ).toBeUndefined()
    }
  })
}, 60000)

test('F03-AC73: Given a page with forms, When the reader moves to a page that allows no form, Then it is moved in the frame', async () => {
  await withPage({}, async (page) => {
    await page.goto(`${TEST_ORIGIN}/slides`)
    await waitForHeader(page)
    await mark(page)
    await follow(page, '.site-footer a[href="/help"]')
    await expect.poll(() => path(page), SETTLE).toBe('/help')
    expect((await kept(page)).document).toBe(true)
  })
}, 30000)

test('F03-AC71: Given the viewer of slides that send their own frame to the origin of another deck, When they do, Then the policy refuses it before a request is made', async () => {
  await withPage({}, async (page) => {
    const reached = new Set<string>()
    page.on('request', (request) => reached.add(new URL(request.url()).origin))
    for (const [button, id] of [
      ['public', secondId],
      ['draft', draftId],
    ]) {
      await page.goto(`${TEST_ORIGIN}/@owner/wander`)
      const violations = await page.evaluateHandle(() => {
        const blocked: string[] = []
        document.addEventListener('securitypolicyviolation', (event) => {
          if (event.effectiveDirective === 'frame-src')
            blocked.push(new URL(event.blockedURI).origin)
        })
        return blocked
      })
      const frame = page.frameLocator('iframe#deck')
      await frame.locator(`#${button}`).click(SETTLE)
      await expect
        .poll(() => violations.jsonValue(), SETTLE)
        .toContain(originOf(id))
      expect(reached.has(originOf(id))).toBe(false)
      expect(await frame.locator('#three').count()).toBe(0)
      expect(path(page)).toBe('/@owner/wander')
    }
  })
}, 60000)

test('F03-AC72: Given a move into the viewer, or out of it, When the link is followed, Then the page is loaded whole', async () => {
  await withPage({}, async (page) => {
    await page.goto(`${TEST_ORIGIN}/`)
    await waitForHeader(page)
    await mark(page)
    const into = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === '/@owner/talk' &&
        request.isNavigationRequest(),
    )
    await page.locator('a[href$="/@owner/talk"]').first().click()
    await into
    await page.waitForURL(`${TEST_ORIGIN}/@owner/talk`)
    expect(await page.evaluate(() => (window as Marked).__page)).toBeUndefined()
    await mark(page)
    const out = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === '/help' &&
        request.isNavigationRequest(),
    )
    await page.locator('.site-footer a[href="/help"]').click()
    await out
    await page.waitForURL(`${TEST_ORIGIN}/help`)
    expect(await page.evaluate(() => (window as Marked).__page)).toBeUndefined()
  })
}, 60000)

/** What a page says about itself: the title and the link-preview metadata. */
const facts = (page: Page) =>
  page.evaluate(() => {
    const content = (selector: string) =>
      document.querySelector(selector)?.getAttribute('content') ?? null
    return {
      title: document.title,
      description: content('meta[name="description"]'),
      ogUrl: content('meta[property="og:url"]'),
      ogImage: content('meta[property="og:image"]'),
      ogTitle: content('meta[property="og:title"]'),
    }
  })

/** The facts of a page loaded whole, in a fresh page of the same context. */
async function factsLoadedWhole(context: BrowserContext, address: string) {
  const other = await context.newPage()
  await other.goto(address)
  const loaded = await facts(other)
  await other.close()
  return loaded
}

test('F03-AC51: Given a move from the top page to the help and to the terms, When each page has come, Then its title and description are the ones of that page', async () => {
  await withPage({}, async (page, context) => {
    await page.goto(`${TEST_ORIGIN}/`)
    await waitForHeader(page)
    await mark(page)
    const home = await facts(page)
    await follow(page, '.site-footer a[href="/help"]')
    await expect.poll(() => path(page), SETTLE).toBe('/help')
    const help = await facts(page)
    expect(help).toEqual(await factsLoadedWhole(context, `${TEST_ORIGIN}/help`))
    expect(help.title).not.toBe(home.title)
    await follow(page, '.site-footer a[href="/terms"]')
    await expect.poll(() => path(page), SETTLE).toBe('/terms')
    const terms = await facts(page)
    expect(terms).toEqual(
      await factsLoadedWhole(context, `${TEST_ORIGIN}/terms`),
    )
    expect(terms.title).not.toBe(help.title)
    expect((await kept(page)).document).toBe(true)
  })
}, 30000)

test('F03-AC53: Given a move to a page with no heading, When it has come, Then the focus is on main', async () => {
  await withPage({ signedIn: false }, async (page) => {
    // The contact page, answered without its headings.
    rewrites.set('/contact', (html) =>
      html.replace(/<h[12][\s\S]*?<\/h[12]>/g, ''),
    )
    await page.goto(`${TEST_ORIGIN}/`)
    await mark(page)
    await follow(page, '.site-footer a[href="/contact"]')
    await expect.poll(() => path(page), SETTLE).toBe('/contact')
    expect(await page.locator('main h1, main h2').count()).toBe(0)
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
      'MAIN',
    )
  })
}, 30000)

test('F03-AC54: Given moves from the terms to the help and to the contact page, When the reader goes back twice and forward twice, Then each page is shown again, without loading a page whole', async () => {
  await withPage({ signedIn: false }, async (page) => {
    await page.goto(`${TEST_ORIGIN}/terms`)
    await mark(page)
    await follow(page, '.site-footer a[href="/help"]')
    await follow(page, '.site-footer a[href="/contact"]')
    await expect.poll(() => path(page), SETTLE).toBe('/contact')
    const heading = () => page.locator('main h1').first().textContent()
    const contact = await heading()
    await page.goBack()
    await expect.poll(() => path(page), SETTLE).toBe('/help')
    await expect.poll(heading, SETTLE).toBe('ヘルプ')
    await page.goBack()
    await expect.poll(() => path(page), SETTLE).toBe('/terms')
    await page.goForward()
    await expect.poll(() => path(page), SETTLE).toBe('/help')
    await page.goForward()
    await expect.poll(heading, SETTLE).toBe(contact)
    expect(await kept(page)).toEqual({
      document: true,
      header: true,
      navigations: 1,
    })
  })
}, 30000)

test('F03-AC55: Given a visitor who is not signed in, When they press the way in, Then the page is loaded whole, to the sign-in', async () => {
  await withPage({ signedIn: false }, async (page) => {
    await page.goto(`${TEST_ORIGIN}/help`)
    await mark(page)
    const link = page.locator('.site-header [data-account] a.sign-in')
    await link.waitFor({ state: 'visible', ...SETTLE })
    const asked = page.waitForRequest((request) =>
      request.url().includes('/login'),
    )
    await link.click()
    const request = await asked
    expect(request.isNavigationRequest()).toBe(true)
    expect(request.headers()['x-slide-move']).toBeUndefined()
  })
}, 30000)

test('F03-AC55: Given a signed-in author, When they sign out, Then the page is loaded again, whole, as a visitor', async () => {
  await withPage({}, async (page) => {
    await page.goto(`${TEST_ORIGIN}/help`)
    await waitForHeader(page)
    await mark(page)
    await page.locator('.site-header summary.avatar').click()
    await page.getByRole('button', { name: 'ログアウト' }).click()
    await expect
      .poll(() => page.evaluate(() => (window as Marked).__page), SETTLE)
      .toBeUndefined()
    await page
      .locator('.site-header [data-account] a.sign-in')
      .waitFor({ state: 'visible', ...SETTLE })
  })
}, 30000)

test('F03-AC55: Given the settings page, When the author sends the form that deletes the account, Then it is a page load of its own, not a move in the frame', async () => {
  await withPage({}, async (page) => {
    await page.goto(`${TEST_ORIGIN}/settings`)
    await waitForHeader(page)
    await mark(page)
    const form = page.locator('form[action="/account/delete"]')
    expect(await form.count()).toBe(1)
    const sent = page.waitForRequest((request) =>
      request.url().endsWith('/account/delete'),
    )
    // The form asks for the author's name first; sending it as it is, is
    // enough to see that it goes as a page load of its own.
    await form.evaluate((element: HTMLFormElement) =>
      HTMLFormElement.prototype.submit.call(element),
    )
    const request = await sent
    expect(request.isNavigationRequest()).toBe(true)
    expect(request.method()).toBe('POST')
  })
}, 30000)

test('F03-AC56, F03-AC69: Given links to another site and to a download, When they are pressed, Then the router leaves them to the browser', async () => {
  await withPage({}, async (page) => {
    await page.goto(`${TEST_ORIGIN}/help`)
    await mark(page)
    await page.evaluate(() => {
      const make = (id: string, href: string, download = false) => {
        const attributes = download ? ' download="help.html"' : ''
        document
          .querySelector('main')
          ?.insertAdjacentHTML(
            'beforeend',
            `<a id="${id}" href="${href}"${attributes}>${id}</a>`,
          )
      }
      make('other-site', 'https://elsewhere.example/landing')
      make('file', '/help', true)
    })
    const navigated = page.waitForRequest((request) =>
      request.url().startsWith('https://elsewhere.example/'),
    )
    await page.locator('#other-site').click()
    expect((await navigated).isNavigationRequest()).toBe(true)
    await page.goto(`${TEST_ORIGIN}/help`)
    await mark(page)
    await page.evaluate(() => {
      document
        .querySelector('main')
        ?.insertAdjacentHTML(
          'beforeend',
          '<a id="file" href="/help" download="help.html">file</a>',
        )
    })
    const download = page.waitForEvent('download')
    await page.locator('#file').click()
    expect((await download).suggestedFilename()).toBe('help.html')
    expect((await kept(page)).document).toBe(true)
  })
}, 30000)

test('F03-AC61: Given a browser that runs no script, When a link is followed, Then the page is loaded whole as it always was', async () => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  try {
    await context.route('**/*', answer)
    const page = await context.newPage()
    await page.goto(`${TEST_ORIGIN}/`)
    await page.locator('.site-footer a[href="/help"]').click()
    await page.waitForURL(`${TEST_ORIGIN}/help`)
    expect(await page.locator('main h1').first().textContent()).toBe('ヘルプ')
    expect(
      await page
        .locator('.site-header noscript a, .site-header a.brand')
        .count(),
    ).toBeGreaterThan(0)
  } finally {
    await context.close()
  }
}, 30000)

/** What a page's elements are drawn as, for the styles a page brings. */
const drawn = (page: Page, selectors: string[]) =>
  page.evaluate((list) => {
    const keys = [
      'display',
      'maxWidth',
      'padding',
      'color',
      'backgroundColor',
      'fontSize',
      'fontWeight',
      'gap',
      'lineHeight',
    ] as const
    const rows = list.map((selector) => {
      const element = document.querySelector(selector)
      if (!element) return [selector, null]
      const style = getComputedStyle(element)
      return [
        selector,
        {
          ...Object.fromEntries(keys.map((k) => [k, style[k]])),
          // Where the page sits and how wide it is; what is inside it waits
          // for the images and the session, so only the page itself is told.
          ...(selector === '.page'
            ? {
                width: element.getBoundingClientRect().width,
                left: element.getBoundingClientRect().left,
              }
            : {}),
        },
      ]
    })
    // The width the page is drawn at, so a difference of it is told apart.
    return [['width', window.innerWidth], ...rows]
  }, selectors)

test.each([
  ['/help', ['main', '.page', '.help', '.help-toc', '.help-body h2']],
  ['/terms', ['main', '.page', '.page h1', '.notice-warning', 'ul']],
  ['/contact', ['main', '.page', '.address', '.address a']],
  ['/slides', ['main', '.page', '.drop-zone', '.page h1']],
])(
  'F03-AC67: Given a move to %s, When the page has come, Then its elements are drawn as they are when the page is loaded whole',
  async (target, selectors) => {
    await withPage({}, async (page, context) => {
      // A page whose policy allows a page's pictures is the one to move from.
      await page.goto(
        `${TEST_ORIGIN}${target === '/slides' ? '/' : '/settings'}`,
      )
      await waitForHeader(page)
      await mark(page)
      const href = target
      await page.evaluate((to: string) => {
        document
          .querySelector('main')
          ?.insertAdjacentHTML('beforeend', `<a id="go" href="${to}">go</a>`)
      }, href)
      await follow(page, '#go')
      await expect.poll(() => path(page), SETTLE).toBe(target)
      expect((await kept(page)).document).toBe(true)
      const moved = await drawn(page, selectors)
      const other = await context.newPage()
      await other.goto(`${TEST_ORIGIN}${target}`)
      await other.waitForLoadState('load')
      await waitForHeader(other)
      const loaded = await drawn(other, selectors)
      expect(moved).toEqual(loaded)
      expect(moved.filter(([, style]) => style === null)).toEqual([])
    })
  },
  30000,
)

test('F03-AC67: Given a move from the help to a page, When the page has come, Then the help’s own styles are gone with the help', async () => {
  await withPage({ signedIn: false }, async (page) => {
    await page.goto(`${TEST_ORIGIN}/help`)
    await mark(page)
    const styles = () => page.locator('main style').count()
    expect(await styles()).toBeGreaterThan(0)
    await follow(page, '.site-footer a[href="/terms"]')
    await expect.poll(() => path(page), SETTLE).toBe('/terms')
    expect(await page.locator('main style:has-text(".help-toc")').count()).toBe(
      0,
    )
  })
}, 30000)

test('F03-AC68: Given moves between the top page and the page of the slides, When each has come, Then its drop frame is ready to take a file, as when the page is loaded whole, and again on the second move to it', async () => {
  await withPage({}, async (page) => {
    await page.goto(`${TEST_ORIGIN}/slides`)
    await waitForHeader(page)
    await mark(page)
    for (let round = 0; round < 2; round += 1) {
      await follow(page, 'a.brand')
      await expect.poll(() => path(page), SETTLE).toBe('/')
      await viaMenu(page, '/slides')
      await expect.poll(() => path(page), SETTLE).toBe('/slides')
      const choose = page.locator('[data-drop-zone] [data-drop-choose]').first()
      await expect.poll(() => choose.isEnabled(), SETTLE).toBe(true)
      const chooser = page.waitForEvent('filechooser')
      await choose.click()
      await chooser
    }
    expect((await kept(page)).document).toBe(true)
  })
}, 60000)

test('F03-AC49, F03-AC53: Given a visitor on the top page, When they open help and switch languages, Then the help heading takes focus on the first move and the second loads the translated page whole', async () => {
  await withPage({ signedIn: false }, async (page) => {
    await page.goto(`${TEST_ORIGIN}/`)
    await mark(page)
    await follow(page, '.site-footer a[href="/help"]')
    await expect.poll(() => path(page), SETTLE).toBe('/help')
    expect(
      await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        text: document.activeElement?.textContent,
        inMain: document.activeElement?.closest('main') !== null,
        heading: document.querySelector('main h1, main h2')?.textContent,
      })),
    ).toEqual({ tag: 'H1', text: 'ヘルプ', inMain: true, heading: 'ヘルプ' })
    const asked = page.waitForRequest((request) =>
      request.url().endsWith('/help?lang=en'),
    )
    await page.locator('.site-footer a[hreflang="en"]').click()
    // The footer stayed through the move, so the link names the page now
    // shown, not the top page it was made for.
    expect((await asked).isNavigationRequest()).toBe(true)
    await page.waitForURL(`${TEST_ORIGIN}/help?lang=en`)
    expect(await page.locator('main h1').first().textContent()).toBe('Help')
    expect(await page.evaluate(() => (window as Marked).__page)).toBeUndefined()
  })
}, 30000)
/**
 * Counts, in the page, what a second binding of /share.js would repeat: the
 * texts written to the clipboard, the addresses written to the history, and
 * the changes made to a share menu's aria-expanded.
 */
async function spyOn(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as {
      __writes: string[]
      __addresses: string[]
      __expanded: number
    }
    w.__writes = []
    w.__addresses = []
    w.__expanded = 0
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          w.__writes.push(text)
        },
      },
    })
    const replace = history.replaceState.bind(history)
    history.replaceState = (state: unknown, title: string, url?: unknown) => {
      w.__addresses.push(String(url))
      return replace(state, title, url as string)
    }
    addEventListener('DOMContentLoaded', () => {
      new MutationObserver((records) => {
        w.__expanded += records.filter(
          (record) => record.attributeName === 'aria-expanded',
        ).length
      }).observe(document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-expanded'],
      })
    })
  })
}

type Spied = Window & {
  __writes: string[]
  __addresses: string[]
  __expanded: number
}

const spied = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as Spied
    return {
      writes: w.__writes,
      addresses: w.__addresses,
      expanded: w.__expanded,
    }
  })

const resetSpy = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as Spied
    w.__writes = []
    w.__addresses = []
    w.__expanded = 0
  })

/**
 * Uses a viewer that was moved to: opens and closes the share menu, copies
 * the link, and turns the slides to page 3. Each is seen once, and only once.
 */
async function useViewer(page: Page, slug: string, turn = 3) {
  const frame = page.frameLocator('iframe#deck')
  await frame.locator('#three').waitFor({ state: 'attached', ...SETTLE })
  await page.locator('#share-page-url').waitFor({ state: 'attached' })
  await resetSpy(page)
  const summary = page.locator('details.share-menu > summary')
  const isOpen = () =>
    page
      .locator('details.share-menu')
      .evaluate((menu) => menu.hasAttribute('open'))
  await summary.click()
  await expect.poll(isOpen, SETTLE).toBe(true)
  await summary.click()
  await expect.poll(isOpen, SETTLE).toBe(false)
  // One press opens it, one closes it: two changes of aria-expanded.
  await expect.poll(async () => (await spied(page)).expanded, SETTLE).toBe(2)
  await summary.click()
  await page.locator('button[data-copy="share-url"]').click()
  await expect
    .poll(async () => (await spied(page)).writes, SETTLE)
    .toEqual([`${TEST_ORIGIN}/@owner/${slug}`])
  await frame.locator(turn === 3 ? '#three' : '#four').click()
  await expect.poll(() => path(page), SETTLE).toBe(`/@owner/${slug}/${turn}`)
  // A moment for a second listener to show itself, if there were one.
  await new Promise((resolve) => setTimeout(resolve, 300))
  const seen = await spied(page)
  expect(
    seen.addresses.filter((address) => address === `/@owner/${slug}/${turn}`),
  ).toHaveLength(1)
  expect(seen.writes).toHaveLength(1)
  expect(await page.locator('#share-page-url').inputValue()).toBe(
    `${TEST_ORIGIN}/@owner/${slug}/${turn}`,
  )
}

/**
 * Goes back until the page shows the address. The slides in the frame keep
 * a history of their own (a page turned by a hash), so one step back may
 * only turn them back.
 */
async function backTo(page: Page, address: string) {
  for (let step = 0; step < 4 && path(page) !== address; step += 1) {
    await page.goBack()
    await expect
      .poll(() => path(page), { timeout: 2000 })
      .toBe(address)
      .catch(() => {})
  }
  expect(path(page)).toBe(address)
}

/** Opens the viewer by its link on the top page: a page load of its own. */
async function openViewer(page: Page, slug: string) {
  await page.goto(`${TEST_ORIGIN}/`)
  await waitForHeader(page)
  const loaded = page.waitForURL(`${TEST_ORIGIN}/@owner/${slug}`)
  await page.locator(`a[href$="/@owner/${slug}"]`).first().click()
  await loaded
}

test('F03-AC57, F03-AC58, F03-AC59, F03-AC60: Given a viewer opened from the top page, and again after leaving it, When the reader uses each, Then the share menu, the copy and the address each act once', async () => {
  await withPage({}, async (page, context) => {
    await spyOn(context)
    await openViewer(page, 'talk')
    await useViewer(page, 'talk')
    await openViewer(page, 'second')
    await useViewer(page, 'second')
    await openViewer(page, 'talk')
    await useViewer(page, 'talk', 4)
  })
}, 90000)

type Shifted = Window & { __shift?: number }

/** Counts, from now on, how far the page moves under the reader's eyes. */
async function watchShifts(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as Shifted
    w.__shift = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number
        hadRecentInput: boolean
      }[])
        if (!entry.hadRecentInput) w.__shift = (w.__shift ?? 0) + entry.value
    }).observe({ type: 'layout-shift', buffered: true })
  })
}

const shifted = (page: Page) =>
  page.evaluate(() => (window as Shifted).__shift ?? 0)

const settledHome = async (page: Page) => {
  await expect
    .poll(
      () => page.locator('.home-following:not([aria-hidden])').count(),
      SETTLE,
    )
    .toBe(1)
  await expect
    .poll(() => page.locator('.recent-body .deck-card').count(), SETTLE)
    .toBeGreaterThan(0)
  // A moment for anything that moves late.
  await new Promise((resolve) => setTimeout(resolve, 500))
}

test('F03-AC82: Given a signed-in author, When they move to the top page from another page, Then the page moves no more than 0.1 while the new slides and the recent slides arrive', async () => {
  await withPage({}, async (page, context) => {
    await watchShifts(context)
    await page.goto(`${TEST_ORIGIN}/help`)
    await waitForHeader(page)
    await page.evaluate(() => ((window as Shifted).__shift = 0))
    await follow(page, 'a.brand')
    await expect.poll(() => path(page), SETTLE).toBe('/')
    await settledHome(page)
    expect(await shifted(page)).toBeLessThanOrEqual(0.1)
  })
}, 60000)

test('F03-AC72: Given an author’s slides that are not public, When they follow the link to them from the slide’s edit page, Then the page is loaded whole, and it sends the form that opens the slides in its frame, once', async () => {
  await withPage({}, async (page) => {
    await page.goto(`${TEST_ORIGIN}/slides/draft`)
    await waitForHeader(page)
    await mark(page)
    const launches: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('.content.'))
        launches.push(request.url())
    })
    const asked = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === '/@owner/draft' &&
        request.isNavigationRequest(),
    )
    await page.locator('a[href*="/@owner/draft?v="]').first().click()
    await asked
    await page.waitForURL(/\/@owner\/draft/)
    // Not moved in the frame: this is another document.
    expect(await page.evaluate(() => (window as Marked).__page)).toBeUndefined()
    await expect.poll(() => launches.length, SETTLE).toBe(1)
    expect(launches[0]).toMatch(/^https:\/\/d-[0-9a-f-]+\.content\.example\//)
    expect(await page.locator('.viewer-notice').count()).toBeGreaterThan(0)
    expect(await page.locator('iframe#deck').getAttribute('name')).toBe(
      'deck-frame',
    )
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(launches).toHaveLength(1)
  })
}, 60000)
