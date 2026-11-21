import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import { signIn, TEST_ORIGIN, testEnv } from '../publication/test-support'

// The top page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
let browser: Browser
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  browser = await chromium.launch()
})
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

// Other browser tests run at the same time.
const SETTLE = { timeout: 10000 }

const ICON = '.site-header [data-account] summary.avatar'
const AVATARS = 'https://avatars.githubusercontent.com'
const PICTURE = `${AVATARS}/u/722500?v=4`
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const ITEMS = '.site-header [data-account] .menu-items'

/**
 * A page of the service, with its requests answered by the Worker. The
 * session cookie is HttpOnly and host-bound, so it is added to each request
 * instead of the browser's jar. `session` answers /api/session in place of
 * the Worker when given; the returned options may be changed between loads.
 * A redirect is not followed: the browser would fetch its target without
 * asking the route. It is kept in `redirects` and answered by an empty page.
 */
async function open(
  path: string,
  options: {
    cookie?: string
    session?: 'fails' | 'waits' | 'refuses'
    picture?: 'fails'
  } = {},
) {
  const redirects: { status: number; location: string | null }[] = []
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === AVATARS && options.picture !== 'fails')
      return route.fulfill({ contentType: 'image/png', body: PIXEL })
    if (url.origin !== TEST_ORIGIN) return route.abort()
    if (options.session === 'fails' && url.pathname === '/api/session')
      return route.abort()
    if (options.session === 'refuses' && url.pathname === '/api/session')
      return route.fulfill({ status: 429, body: 'Too many requests' })
    // Left unanswered: what the page shows meanwhile is from the last visit.
    if (options.session === 'waits' && url.pathname === '/api/session') return
    // Miniflare's local proxy refuses an Origin outside its own hostnames.
    const request = route.request()
    const { origin: _origin, ...headers } = await request.allHeaders()
    if (options.cookie) headers.cookie = options.cookie
    // The route sees a request before Chromium adds Sec-Fetch-Site, which
    // is what lets a form post from these no-referrer pages past the CSRF
    // check. Say here what the browser would: the pages load nothing else.
    if (new URL(request.frame().url()).origin === TEST_ORIGIN)
      headers['sec-fetch-site'] = 'same-origin'
    const response = await server.fetch(
      new Request(url, {
        method: request.method(),
        headers,
        body: request.postData(),
        redirect: 'manual',
      }),
      env,
    )
    if (response.status >= 300 && response.status < 400) {
      redirects.push({
        status: response.status,
        location: response.headers.get('Location'),
      })
      return route.fulfill({ status: 200, contentType: 'text/html', body: '' })
    }
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    })
  })
  await page.goto(`${TEST_ORIGIN}${path}`)
  return { page, errors, options, redirects }
}

test.each([['/'], ['/help'], ['/terms']])(
  'F03-AC26: Given a visitor who is not signed in, When %s opens, Then the header’s way in leads straight to signing in with GitHub and the page allows the request',
  async (path) => {
    const { page, errors } = await open(path)
    const link = page.locator('.site-header [data-account] a')
    await expect.poll(() => link.textContent(), SETTLE).toBe('ログイン')
    expect(await link.getAttribute('href')).toBe('/auth/github')
    expect(errors).toEqual([])
    await page.close()
  },
)

test.each([['/'], ['/slides']])(
  'F03-AC25: Given a signed-in author, When %s opens, Then the header shows only the bell and their icon, with no link to their slides and no button to add slides, and the menu is closed',
  async (path) => {
    const cookie = await signIn(env, 'kobaken')
    const { page, errors } = await open(path, { cookie })
    const icon = page.locator(ICON)
    await expect.poll(() => icon.count(), SETTLE).toBe(1)
    expect(await icon.textContent()).toBe('k')
    expect(await icon.getAttribute('aria-label')).toBe('メニュー (kobaken)')
    expect(await icon.getAttribute('aria-expanded')).toBe('false')
    const area = page.locator('.site-header [data-account]')
    expect(
      await area
        .locator(':scope > a')
        .evaluateAll((links) =>
          links.map((link) => [
            link.getAttribute('href'),
            link.textContent || link.getAttribute('aria-label'),
          ]),
        ),
    ).toEqual([['/notifications', 'お知らせ']])
    expect(await area.locator('a.add, [href="/slides/new"]').count()).toBe(0)
    // What is pressed is 44px; the circle drawn in it is 36px.
    for (const target of [icon, area.locator('a.bell')]) {
      const box = await target.boundingBox()
      expect([box?.width, box?.height]).toEqual([44, 44])
      const face = await target.locator(':scope > span').boundingBox()
      expect([face?.width, face?.height]).toEqual([36, 36])
    }
    expect(await page.locator(ITEMS).isVisible()).toBe(false)
    expect(errors).toEqual([])
    await page.close()
  },
)

test('F03-AC27 F03-AC28: Given a signed-in author, When their icon is pressed, Then the menu lists the profile, the decks (leading to /slides), the settings and signing out, and closes on Escape or a click outside', async () => {
  const cookie = await signIn(env, 'kobaken')
  const { page } = await open('/', { cookie })
  const icon = page.locator(ICON)
  await expect.poll(() => icon.count(), SETTLE).toBe(1)
  const items = page.locator(ITEMS)

  await icon.click()
  expect(await items.isVisible()).toBe(true)
  await expect
    .poll(() => icon.getAttribute('aria-expanded'), SETTLE)
    .toBe('true')
  expect(
    await items
      .locator('a')
      .evaluateAll((links) =>
        links.map((link) => [link.getAttribute('href'), link.textContent]),
      ),
  ).toEqual([
    // The handle was taken from the login at the first sign-in.
    ['/@kobaken', 'プロフィール'],
    ['/slides', 'スライドの管理'],
    ['/settings', '設定'],
  ])
  const logout = items.locator('form')
  expect(await logout.getAttribute('action')).toMatch(/\/auth\/logout$/)
  expect(await logout.getAttribute('method')).toBe('post')
  expect(await logout.locator('button').textContent()).toBe('ログアウト')

  await page.keyboard.press('Escape')
  expect(await items.isVisible()).toBe(false)
  await icon.click()
  expect(await items.isVisible()).toBe(true)
  await page.locator('footer').click({ position: { x: 2, y: 2 } })
  expect(await items.isVisible()).toBe(false)
  await page.close()
})

test('Given a signed-in author with the menu open, When signing out is pressed, Then the session ends and the next page shows the way in', async () => {
  const cookie = await signIn(env, 'kobaken')
  const { page, options, redirects } = await open('/', { cookie })
  const icon = page.locator(ICON)
  await expect.poll(() => icon.count(), SETTLE).toBe(1)
  await icon.click()
  // Signing out ends by reading the page again. That reading is waited for:
  // a visit started before it would be interrupted by it. Its session is
  // left unanswered, so what it shows is only what this browser kept.
  options.session = 'waits'
  const readAgain = page.waitForEvent('load')
  await page.locator(`${ITEMS} button`).click()
  await readAgain
  expect(redirects).toEqual([{ status: 303, location: '/' }])
  // It is the top page that was read again, by the script: a form sent as
  // written would have left the browser on the answer of /auth/logout.
  expect(page.url()).toBe(`${TEST_ORIGIN}/`)
  const area = page.locator('.site-header [data-account]')
  expect(await area.count()).toBe(1)
  // The icon kept from the last visit is forgotten before any answer comes.
  expect(await area.innerHTML()).toBe('')
  expect(await page.locator(ICON).count()).toBe(0)
  // The same cookie is sent again: the server no longer knows the session.
  options.session = undefined
  await page.goto(`${TEST_ORIGIN}/`)
  const link = page.locator('.site-header [data-account] a')
  await expect.poll(() => link.textContent(), SETTLE).toBe('ログイン')
  expect(await page.locator(ICON).count()).toBe(0)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.close()
})

test('Given the session cannot be asked, When the top page opens, Then the header falls back to the way in', async () => {
  const { page } = await open('/', { session: 'fails' })
  const link = page.locator('.site-header [data-account] a')
  await expect.poll(() => link.textContent(), SETTLE).toBe('ログイン')
  expect(await link.getAttribute('href')).toBe('/auth/github')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.close()
})

test('Given a page as written, When no script has run, Then the header link is empty and the way in is offered without scripts', async () => {
  const page = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/help`), env)
  ).text()
  expect(page).toMatch(/<span[^>]*data-account[^>]*><\/span>/)
  expect(page).toContain(
    '<noscript><a href="/auth/github">ログイン</a></noscript>',
  )
})

test('Given an author whose last visit was signed in, When the next page opens and the session has not answered yet, Then their icon is already shown', async () => {
  const cookie = await signIn(env, 'kobaken')
  const { page, options } = await open('/', { cookie })
  const icon = page.locator(ICON)
  await expect.poll(() => icon.count(), SETTLE).toBe(1)

  options.session = 'waits'
  await page.goto(`${TEST_ORIGIN}/slides`, { waitUntil: 'domcontentloaded' })
  await expect.poll(() => icon.count(), SETTLE).toBe(1)
  expect(await icon.textContent()).toBe('k')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.close()
})

test('Given an author who signed out since their last visit, When the next page opens, Then the kept icon is replaced by the way in', async () => {
  const cookie = await signIn(env, 'kobaken')
  const { page, options } = await open('/', { cookie })
  const icon = page.locator(ICON)
  await expect.poll(() => icon.count(), SETTLE).toBe(1)

  options.cookie = undefined
  await page.goto(`${TEST_ORIGIN}/`)
  const link = page.locator('.site-header [data-account] a')
  await expect.poll(() => link.textContent(), SETTLE).toBe('ログイン')
  expect(await link.getAttribute('href')).toBe('/auth/github')
  expect(await icon.count()).toBe(0)
  await page.close()
})

test('Given an author whose last visit was signed in, When the session refuses to answer, Then their icon stays', async () => {
  const cookie = await signIn(env, 'kobaken')
  const { page, options } = await open('/', { cookie })
  const icon = page.locator(ICON)
  await expect.poll(() => icon.count(), SETTLE).toBe(1)

  options.session = 'refuses'
  const refused = page.waitForResponse((response) =>
    response.url().endsWith('/api/session'),
  )
  await page.goto(`${TEST_ORIGIN}/`)
  await refused
  await expect.poll(() => icon.count(), SETTLE).toBe(1)
  expect(await page.locator('.site-header [data-account] a.bell').count()).toBe(
    1,
  )
  await page.close()
})

test.each(['/', '/slides'])(
  "Given a signed-in author with a picture on GitHub, When %s opens, Then the icon shows the picture at the icon's size, and the page policy lets it load",
  async (path) => {
    const cookie = await signIn(env, 'kobaken', {
      profile: { avatar_url: PICTURE },
    })
    const { page, errors } = await open(path, { cookie })
    const picture = page.locator(`${ICON} img`)
    await expect
      .poll(
        () =>
          picture.evaluateAll((all) =>
            all.map((img) => (img as HTMLImageElement).naturalWidth),
          ),
        SETTLE,
      )
      .toEqual([1])
    expect(await picture.getAttribute('src')).toBe(`${PICTURE}&s=64`)
    expect(await page.locator(ICON).getAttribute('aria-label')).toBe(
      'メニュー (kobaken)',
    )
    expect(errors).toEqual([])
    await page.close()
  },
)

test('Given a signed-in author whose picture cannot be loaded, When the top page opens, Then the icon shows their initial', async () => {
  const cookie = await signIn(env, 'kobaken', {
    profile: { avatar_url: PICTURE },
  })
  const { page } = await open('/', { cookie, picture: 'fails' })
  const icon = page.locator(ICON)
  await expect.poll(() => icon.count(), SETTLE).toBe(1)
  await expect.poll(() => icon.locator('img').count(), SETTLE).toBe(0)
  expect(await icon.textContent()).toBe('k')
  await page.close()
})

test('Given a kept answer naming a picture somewhere else, When the next page opens before the session answers, Then no picture is asked for', async () => {
  const { page, options } = await open('/')
  // The first page keeps its own answer when it comes, which may be after
  // the page has loaded. It is waited for, so it cannot replace what is
  // kept below.
  const wayIn = page.locator('.site-header [data-account] a.sign-in')
  await expect.poll(() => wayIn.count(), SETTLE).toBe(1)
  await page.evaluate(() =>
    localStorage.setItem(
      'slide:session',
      JSON.stringify({
        signedIn: true,
        login: 'kobaken',
        handle: 'kobaken',
        avatarUrl: 'https://evil.example/a.png',
      }),
    ),
  )
  options.session = 'waits'
  await page.goto(`${TEST_ORIGIN}/`, { waitUntil: 'domcontentloaded' })
  const icon = page.locator(ICON)
  await expect.poll(() => icon.count(), SETTLE).toBe(1)
  expect(await icon.locator('img').count()).toBe(0)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.close()
})

test('F03-AC24: Given a signed-in author with an unread notification, When a page opens, Then the bell carries a dot and its name gives the number', async () => {
  const cookie = await signIn(env, 'kobaken')
  const { page } = await open('/help', { cookie })
  const bell = page.locator('.site-header [data-account] a.bell')
  await expect.poll(() => bell.count(), SETTLE).toBe(1)
  expect(await bell.locator('.unread-dot').count()).toBe(0)
  expect(await bell.getAttribute('aria-label')).toBe('お知らせ')

  await platform.env.DB.batch([
    platform.env.DB.prepare(
      "INSERT INTO accounts (user_id, handle, created_at) VALUES ('77', 'fan', 1)",
    ),
    platform.env.DB.prepare(
      "INSERT INTO notifications (id, recipient_user_id, kind, actor_user_id, created_at) SELECT 'n1', user_id, 'followed', '77', 1 FROM accounts WHERE handle = 'kobaken'",
    ),
  ])
  await page.goto(`${TEST_ORIGIN}/help`)
  await expect.poll(() => bell.locator('.unread-dot').count(), SETTLE).toBe(1)
  expect(await bell.getAttribute('aria-label')).toBe('お知らせ(1)')
  await page.close()
})

const sessionOf = async (cookie: string) =>
  (
    await server.fetch(
      new Request(`${TEST_ORIGIN}/api/session`, { headers: { cookie } }),
      env,
    )
  ).json() as Promise<{ signedIn: boolean }>

test('Given an author who signs out before the page’s own session answer has come, When that answer says they are signed in and comes after the sign-out, Then it is not kept and the page read again shows no icon', async () => {
  const cookie = await signIn(env, 'kobaken')
  const { page } = await open('/', { cookie })
  const icon = page.locator(ICON)
  await expect.poll(() => icon.count(), SETTLE).toBe(1)
  // What the server said while the session still stood.
  const stale = await sessionOf(cookie)
  expect(stale.signedIn).toBe(true)

  // The next page's question is held. The page read again after signing
  // out is left unanswered, so it shows only what this browser kept.
  let answerStale = () => {}
  const held = new Promise<void>((resolve) => {
    answerStale = resolve
  })
  let asked = 0
  await page.route(`${TEST_ORIGIN}/api/session`, async (route) => {
    asked += 1
    if (asked > 1) return
    await held
    await route.fulfill({ json: stale })
  })
  // Tells when the page has read a session answer and acted on it: the
  // page's own steps run before the timer set here does.
  let pageActed = () => {}
  const acted = new Promise<void>((resolve) => {
    pageActed = resolve
  })
  await page.exposeFunction('sessionAnswerRead', () => pageActed())
  await page.addInitScript(() => {
    const json = Response.prototype.json
    Response.prototype.json = function (this: Response) {
      const body = json.call(this)
      if (this.url.endsWith('/api/session'))
        void body.then(() =>
          setTimeout(
            () =>
              (
                window as unknown as { sessionAnswerRead: () => void }
              ).sessionAnswerRead(),
            0,
          ),
        )
      return body
    }
  })
  await page.goto(`${TEST_ORIGIN}/`)
  // Drawn from the last visit, so it can be pressed before the answer.
  await expect.poll(() => icon.count(), SETTLE).toBe(1)

  // The sign-out has been answered once the page asks to be read again.
  // That reading is held until the old page has acted on the stale answer.
  await page.route(`${TEST_ORIGIN}/`, async (route) => {
    answerStale()
    await acted
    await route.fallback()
  })
  const readAgain = page.waitForEvent('load')
  await icon.click()
  await page.locator(`${ITEMS} button`).click()
  await readAgain

  expect(page.url()).toBe(`${TEST_ORIGIN}/`)
  expect(asked).toBe(2)
  expect((await sessionOf(cookie)).signedIn).toBe(false)
  expect(
    await page.evaluate(() => localStorage.getItem('slide:session')),
  ).toBeNull()
  expect(await page.locator(ICON).count()).toBe(0)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.close()
})

// These pages allow no form to be sent, so signing out cannot be a form.
test.each([['/help'], ['/terms'], ['/no-such-page'], ['/slides']])(
  'F03-AC24: Given a signed-in author on %s, When they sign out from the header’s menu, Then the session ends, the page policy refuses nothing, and the next page shows the way in',
  async (path) => {
    const cookie = await signIn(env, 'kobaken')
    const { page, errors } = await open(path, { cookie })
    const icon = page.locator(ICON)
    await expect.poll(() => icon.count(), SETTLE).toBe(1)
    expect((await sessionOf(cookie)).signedIn).toBe(true)

    await icon.click()
    await page.locator(`${ITEMS} button`).click()

    await expect
      .poll(async () => (await sessionOf(cookie)).signedIn, SETTLE)
      .toBe(false)
    const link = page.locator('.site-header [data-account] a.sign-in')
    await expect.poll(() => link.count(), SETTLE).toBe(1)
    expect(await page.locator(ICON).count()).toBe(0)
    expect(
      errors.filter((error) => /Content Security Policy/.test(error)),
    ).toEqual([])
    // What the browser kept of the session is forgotten once it has ended.
    expect(
      await page.evaluate(() => localStorage.getItem('slide:session')),
    ).not.toContain('"signedIn":true')
    await page.close()
  },
)

test('Given signing out cannot be answered, When it is pressed, Then the kept session stays and the author is still shown as signed in', async () => {
  const cookie = await signIn(env, 'kobaken')
  const { page } = await open('/help', { cookie })
  const icon = page.locator(ICON)
  await expect.poll(() => icon.count(), SETTLE).toBe(1)
  await page.route(`${TEST_ORIGIN}/auth/logout`, (route) => route.abort())

  await icon.click()
  await page.locator(`${ITEMS} button`).click()
  await page.waitForTimeout(500)

  expect((await sessionOf(cookie)).signedIn).toBe(true)
  expect(
    await page.evaluate(() => localStorage.getItem('slide:session')),
  ).toContain('"signedIn":true')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.close()
})
