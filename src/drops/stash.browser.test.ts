import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { decks, deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { dropFiles, openPage } from './test-browser'

// The pages load /drop.js and /drop-core.js from `pnpm build`; CI builds
// before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = testEnv(platform.env)
let browser: Browser

// Other browser tests run at the same time, and a drop is several round
// trips, so each wait and each test gets longer than the default.
const SETTLE = { timeout: 60000 }
vi.setConfig({ testTimeout: 120000, hookTimeout: 60000 })
const ZONE = '[data-drop-zone="new"]'
const talk = {
  name: 'Kept Talk.html',
  type: 'text/html',
  text: '<!doctype html><head><title>Kept Talk</title></head><body>k</body>',
}
const ready = (page: Page) =>
  expect
    .poll(() => page.locator(`${ZONE} [data-drop-choose]`).isEnabled(), SETTLE)
    .toBe(true)
const writes = (exchanges: readonly { method: string }[]) =>
  exchanges.filter(({ method }) => method !== 'GET')
/** What the browser keeps for the visitor, as the page's own script would read it. */
const kept = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ name: string; attempt: string } | null>((resolve) => {
        const opening = indexedDB.open('slide-drop', 1)
        opening.onupgradeneeded = () =>
          opening.result.createObjectStore('pending')
        opening.onsuccess = () => {
          const request = opening.result
            .transaction('pending')
            .objectStore('pending')
            .get('drop')
          request.onsuccess = () =>
            resolve(
              request.result
                ? {
                    name: request.result.file.name,
                    attempt: request.result.attempt,
                  }
                : null,
            )
        }
      }),
  )
/** A visitor who is not signed in picks a file on the top page. */
async function pickSignedOut(options: Parameters<typeof openPage>[3] = {}) {
  const visit = await openPage(browser, env, '/', options)
  await ready(visit.page)
  await dropFiles(visit.page, ZONE, [talk])
  await expect
    .poll(() => visit.page.locator(ZONE).getAttribute('data-picked'), SETTLE)
    .toBe('')
  return visit
}
const continueLink = (page: Page) =>
  page.locator(ZONE).getByRole('link', { name: 'GitHub でログインして続ける' })

beforeAll(async () => {
  await applyMigrations(database)
  browser = await chromium.launch()
})
beforeEach(() => resetTables(database))
afterAll(async () => {
  await browser?.close()
  await platform.dispose()
})

test('F22-AC9: Given a visitor who is not signed in, When they pick a file on the top page, Then the frame shows the file\’s name and size with the way to sign in, and nothing is sent to the service', async () => {
  const { page, exchanges, errors } = await pickSignedOut()
  const zone = page.locator(ZONE)

  expect(await zone.locator('[data-drop-title]').textContent()).toBe(
    'このスライドを置きます',
  )
  expect(await zone.locator('.drop-file').textContent()).toBe(
    'Kept Talk.html(1 KB)',
  )
  const link = zone.getByRole('link', { name: 'GitHub でログインして続ける' })
  expect(await link.getAttribute('href')).toBe('/auth/github?to=top')
  expect(
    await zone.getByRole('button', { name: '別のファイルにする' }).isVisible(),
  ).toBe(true)
  expect(await zone.locator('[data-drop-note]').textContent()).toBe(
    'ログインのあと、このページに戻って自動で受け取ります。公開するまでは自分だけが見られます。',
  )
  // The line turns solid, and the button to choose is out of the way.
  expect(
    await zone.evaluate((element) => getComputedStyle(element).borderTopStyle),
  ).toBe('solid')
  expect(await zone.locator('[data-drop-choose]').isVisible()).toBe(false)
  // Only reads went out: who is signed in, and the page's own files.
  expect(writes(exchanges)).toEqual([])
  expect(await db.$count(decks)).toBe(0)
  expect(await kept(page)).toMatchObject({ name: 'Kept Talk.html' })
  expect(errors).toEqual([])
  await page.context().close()
})

test('F22-AC10: Given a file kept before signing in, When the visitor presses "Sign in with GitHub to continue" and comes back signed in, Then the file is received by itself and the slide’s page opens', async () => {
  const { page, exchanges } = await pickSignedOut({
    signIn: () => signIn(env, 'alice'),
  })
  const stored = await kept(page)

  await continueLink(page).click()

  await page.waitForURL(`${TEST_ORIGIN}/slides/kept-talk`, SETTLE)
  await expect
    .poll(() => page.locator('h1').textContent(), SETTLE)
    .toBe('Kept Talk')
  expect(
    await db
      .select({ state: deployments.state, key: deployments.idempotency_key })
      .from(deployments),
  ).toEqual([
    // The attempt made when the file was kept names the upload.
    { state: 'ready', key: `new:${OWNER_ID}:${stored?.attempt}` },
  ])
  expect(
    await db.select({ public: decks.public_deployment_id }).from(decks),
  ).toEqual([{ public: null }])
  // The file is not kept any longer: the top page again sends nothing.
  const sent = writes(exchanges).length
  await page.goto(`${TEST_ORIGIN}/`)
  await ready(page)
  expect(await kept(page)).toBeNull()
  expect(writes(exchanges)).toHaveLength(sent)
  expect(await db.$count(decks)).toBe(1)
  await page.context().close()
})

test('F22-AC11: Given a file someone kept and walked away from, When another person signs in from the header and opens the top page, Then nothing is sent in their name, and they see the ordinary top page', async () => {
  const before = await pickSignedOut()
  await before.page.close()
  // Signed in elsewhere: no "continue" was pressed for this file.
  const cookie = await signIn(env, 'alice')

  const { page, exchanges, errors } = await openPage(browser, env, '/', {
    cookie,
    context: before.page.context(),
  })
  await ready(page)

  expect(writes(exchanges)).toEqual([])
  expect(await db.$count(decks)).toBe(0)
  const zone = page.locator(ZONE)
  expect(await zone.getAttribute('data-picked')).toBeNull()
  expect(await zone.getAttribute('data-busy')).toBeNull()
  expect(await zone.locator('[data-drop-title]').textContent()).toBe(
    'スライドをここにドロップ',
  )
  expect(await zone.locator('[role="alert"]').count()).toBe(0)
  expect(errors).toEqual([])
  // The file stays kept: a visitor who is not signed in sees it again.
  const visitor = await openPage(browser, env, '/', {
    context: before.page.context(),
  })
  await expect
    .poll(() => visitor.page.locator(ZONE).getAttribute('data-picked'), SETTLE)
    .toBe('')
  expect(writes(visitor.exchanges)).toEqual([])
  await page.context().close()
})

test('F22-AC10: Given "continue" was pressed in one tab, When the top page is open signed in in another tab, Then only the tab that pressed it receives the file, and only once', async () => {
  const first = await pickSignedOut({ signIn: () => signIn(env, 'alice') })
  const cookie = await signIn(env, 'alice')
  // Another tab of the same browser, already signed in: it has no mark.
  const other = await openPage(browser, env, '/', {
    cookie,
    context: first.page.context(),
  })
  await ready(other.page)
  expect(writes(other.exchanges)).toEqual([])

  await continueLink(first.page).click()
  await first.page.waitForURL(`${TEST_ORIGIN}/slides/kept-talk`, SETTLE)

  // Reading the other tab again, and going back in the first, send nothing.
  await other.page.reload()
  await ready(other.page)
  expect(writes(other.exchanges)).toEqual([])
  const sent = writes(first.exchanges).length
  await first.page.goBack()
  await ready(first.page)
  expect(writes(first.exchanges)).toHaveLength(sent)
  expect(await db.$count(decks)).toBe(1)
  expect(await db.$count(deployments)).toBe(1)
  await first.page.context().close()
})

test('F22-AC10: Given the upload after "continue" does not finish, When the page is read again, Then the file is not sent a second time by itself', async () => {
  const { page, exchanges } = await pickSignedOut({
    signIn: () => signIn(env, 'alice'),
    down: (method) => method === 'PUT',
  })

  await continueLink(page).click()
  await expect
    .poll(() => page.locator(`${ZONE} [role="alert"]`).textContent(), SETTLE)
    .toBe('受け取りを終えられませんでした。もう一度ドロップしてください。')
  const sent = writes(exchanges).length

  await page.reload()
  await ready(page)

  // The mark worked once; the file stays kept, and nothing more is sent.
  expect(writes(exchanges)).toHaveLength(sent)
  expect(await kept(page)).toMatchObject({ name: 'Kept Talk.html' })
  await page.context().close()
})

test.each([
  ['has not answered yet', 'waits'],
  ['answers 429', 'refuses'],
] as const)(
  'F22-AC9: Given the service %s who is signed in, When a visitor drops a file, Then nothing about the file is sent: it is kept and the frame asks to sign in',
  async (_name, mode) => {
    const answered = Promise.withResolvers<void>()
    const { page, exchanges } = await openPage(browser, env, '/', {
      hold: (_method, path) =>
        mode === 'waits' && path === '/api/session'
          ? answered.promise
          : undefined,
      down: (_method, path) => mode === 'refuses' && path === '/api/session',
    })
    await page.locator(`${ZONE} [data-drop-title]`).waitFor(SETTLE)

    await dropFiles(page, ZONE, [talk])
    // While nobody knows who is here, the file waits in the page.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(writes(exchanges)).toEqual([])
    answered.resolve()

    await expect
      .poll(() => page.locator(ZONE).getAttribute('data-picked'), SETTLE)
      .toBe('')
    expect(writes(exchanges)).toEqual([])
    expect(await kept(page)).toMatchObject({ name: 'Kept Talk.html' })
    expect(await db.$count(decks)).toBe(0)
    await page.context().close()
  },
)

test('F22-AC10: Given the way to sign in from a kept file, When the sign-in with GitHub finishes, Then the visitor lands on the top page', async () => {
  const start = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/github?to=top`),
    env,
  )
  const state = new URL(start.headers.get('location') ?? '').searchParams.get(
    'state',
  )
  vi.stubGlobal('fetch', async (input: RequestInfo) => {
    const url = String(input instanceof Request ? input.url : input)
    if (new URL(url).pathname.endsWith('/followers')) return Response.json([])
    if (url.endsWith('/user/emails')) return Response.json([])
    if (url.endsWith('/access_token'))
      return Response.json({ access_token: 'gho_x' })
    if (url.endsWith('/user'))
      return Response.json({ id: Number(OWNER_ID), login: 'alice' })
    return new Response(null, { status: 204 })
  })
  try {
    const callback = await server.fetch(
      new Request(`${TEST_ORIGIN}/auth/github/callback?code=c&state=${state}`, {
        headers: {
          Cookie: start.headers.getSetCookie()[0]?.split(';')[0] ?? '',
        },
      }),
      env,
    )

    expect(callback.status).toBeGreaterThanOrEqual(300)
    expect(callback.status).toBeLessThan(400)
    const landing = new URL(callback.headers.get('location') ?? '', TEST_ORIGIN)
    expect(landing.origin + landing.pathname).toBe(`${TEST_ORIGIN}/`)
    expect(
      callback.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith('__Host-slide_owner=')),
    ).toBe(true)
  } finally {
    vi.unstubAllGlobals()
  }
})

test('F22-AC11: Given no file is kept, When a signed-in author opens the top page, Then it is the ordinary top page: the smaller frame, nothing sent, no error', async () => {
  const cookie = await signIn(env, 'alice')

  const { page, exchanges, errors } = await openPage(browser, env, '/', {
    cookie,
  })
  await ready(page)

  const zone = page.locator(ZONE)
  expect(await zone.locator('[data-drop-title]').textContent()).toBe(
    'スライドをここにドロップ',
  )
  expect(await zone.getAttribute('data-picked')).toBeNull()
  expect(await zone.getAttribute('data-busy')).toBeNull()
  expect(await zone.locator('[role="alert"]').count()).toBe(0)
  expect(
    await zone.evaluate((element) =>
      element.classList.contains('drop-zone-large'),
    ),
  ).toBe(false)
  expect(writes(exchanges)).toEqual([])
  expect(errors).toEqual([])
  expect(await db.$count(decks)).toBe(0)
  await page.context().close()
})

test.each([
  ['kept more than 24 hours ago', { ageMs: 24 * 60 * 60 * 1000 + 1000 }],
  ['that is not a file at all', { broken: true }],
])(
  'F22-AC11: Given something %s in the browser\’s storage, When a signed-in author opens the top page, Then nothing is sent, no error shows, and the storage is cleared',
  async (_name, stale) => {
    const first = await openPage(browser, env, '/')
    await ready(first.page)
    await first.page.evaluate(
      ({ ageMs, broken }) =>
        new Promise<void>((resolve) => {
          const opening = indexedDB.open('slide-drop', 1)
          opening.onupgradeneeded = () =>
            opening.result.createObjectStore('pending')
          opening.onsuccess = () => {
            const transaction = opening.result.transaction(
              'pending',
              'readwrite',
            )
            transaction.objectStore('pending').put(
              broken
                ? { file: 'talk.html', attempt: 1 }
                : {
                    file: new File(['<!doctype html>'], 'old.html'),
                    attempt: crypto.randomUUID(),
                    storedAt: Date.now() - (ageMs ?? 0),
                  },
              'drop',
            )
            transaction.oncomplete = () => resolve()
          }
        }),
      stale as { ageMs?: number; broken?: boolean },
    )
    await first.page.close()
    const cookie = await signIn(env, 'alice')

    const { page, exchanges, errors } = await openPage(browser, env, '/', {
      cookie,
      context: first.page.context(),
    })
    await ready(page)

    expect(writes(exchanges)).toEqual([])
    expect(errors).toEqual([])
    expect(await page.locator(`${ZONE} [role="alert"]`).count()).toBe(0)
    expect(await kept(page)).toBeNull()
    expect(await db.$count(decks)).toBe(0)
    await page.context().close()
  },
)

test('F22-AC12: Given a kept file, When the visitor presses "Choose another file", Then the file is forgotten and the frame is as it was', async () => {
  const { page, exchanges } = await pickSignedOut()
  const zone = page.locator(ZONE)

  await zone.getByRole('button', { name: '別のファイルにする' }).click()

  await expect.poll(() => zone.getAttribute('data-picked'), SETTLE).toBeNull()
  expect(await zone.locator('[data-drop-title]').textContent()).toBe(
    'スライドをここにドロップ',
  )
  expect(await zone.locator('[data-drop-note]').textContent()).toContain(
    '共有用の URL ができます。',
  )
  expect(await zone.locator('[data-drop-choose]').isVisible()).toBe(true)
  expect(await zone.locator('.drop-picked').isVisible()).toBe(false)
  expect(await kept(page)).toBeNull()
  expect(writes(exchanges)).toEqual([])
  // Coming back, even signed in, receives nothing.
  const cookie = await signIn(env, 'alice')
  const after = await openPage(browser, env, '/', {
    cookie,
    context: page.context(),
  })
  await ready(after.page)
  expect(writes(after.exchanges)).toEqual([])
  expect(await db.$count(decks)).toBe(0)
  await page.context().close()
})

test('Given a kept file, When the visitor comes back still signed out, Then the frame shows the kept file again and still sends nothing', async () => {
  const before = await pickSignedOut()
  await before.page.close()

  const { page, exchanges } = await openPage(browser, env, '/', {
    context: before.page.context(),
  })

  await expect
    .poll(() => page.locator(ZONE).getAttribute('data-picked'), SETTLE)
    .toBe('')
  expect(await page.locator(`${ZONE} .drop-file`).textContent()).toBe(
    'Kept Talk.html(1 KB)',
  )
  expect(writes(exchanges)).toEqual([])
  await page.context().close()
})

test('Given a kept file, When the visitor picks another, Then only the newer one is kept', async () => {
  const { page } = await pickSignedOut()

  await dropFiles(page, ZONE, [{ ...talk, name: 'Newer.html' }])

  await expect
    .poll(() => page.locator(`${ZONE} .drop-file`).textContent(), SETTLE)
    .toBe('Newer.html(1 KB)')
  expect(await kept(page)).toMatchObject({ name: 'Newer.html' })
  await page.context().close()
})

test('F22-AC6: Given a visitor who is not signed in, When they pick a file that would not be taken, Then the reason shows at once and nothing is kept', async () => {
  const { page, exchanges } = await openPage(browser, env, '/')
  await ready(page)

  await dropFiles(page, ZONE, [
    { name: 'talk.pdf', type: 'application/pdf', text: '%PDF' },
  ])

  await expect
    .poll(() => page.locator(`${ZONE} [role="alert"]`).textContent(), SETTLE)
    .toBe('HTML(.html)か zip のファイルを選んでください。')
  expect(await kept(page)).toBeNull()
  expect(writes(exchanges)).toEqual([])
  await page.context().close()
})

test('F22-AC16: Given a file kept by someone whose GitHub account is not registered, When they try to sign in, Then they are told the service is by invitation, they are not signed in, and the kept file is not sent', async () => {
  const before = await pickSignedOut()
  await before.page.close()
  // The sign-in a person outside the registration gets: no session.
  const refused = await signIn(env, 'stranger', { id: INVITED_ID })
  expect(refused).toBe('')
  const told = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/invitation-only`),
    env,
  )
  expect(await told.text()).toContain('招待制')

  // Back on the top page they are still a visitor.
  const { page, exchanges } = await openPage(browser, env, '/', {
    cookie: refused,
    context: before.page.context(),
  })
  await expect
    .poll(() => page.locator(ZONE).getAttribute('data-picked'), SETTLE)
    .toBe('')

  expect(writes([...before.exchanges, ...exchanges])).toEqual([])
  expect(await db.$count(decks)).toBe(0)
  expect(await db.$count(deployments)).toBe(0)
  await page.context().close()
})

test('Given an author whose session ended while the top page was open, When they drop a file, Then it is kept for the next sign-in instead of being lost', async () => {
  const cookie = await signIn(env, 'alice')
  const { page } = await openPage(browser, env, '/', { cookie })
  await ready(page)
  // The session ends on the service; the page still thinks it is signed in.
  await resetTables(database)

  await dropFiles(page, ZONE, [talk])

  await expect
    .poll(() => page.locator(ZONE).getAttribute('data-picked'), SETTLE)
    .toBe('')
  expect(await kept(page)).toMatchObject({ name: 'Kept Talk.html' })
  expect(await db.$count(decks)).toBe(0)
  await page.context().close()
})
