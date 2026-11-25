import { openTestBrowser } from '../test-open-browser'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import type { Browser, Page } from 'playwright'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { accounts, decks, deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  emailOf,
  INVITED_ID,
  lastCode,
  OWNER_ID,
  resetTables,
  seedPerson,
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
const RETURN_TOKEN = '9d0b6a51-7c1e-4f55-8a43-5e2f1b7c9a10'
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
  page.locator(ZONE).getByRole('link', { name: 'ログインして続ける' })

beforeAll(async () => {
  await applyMigrations(database)
  browser = await openTestBrowser()
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
  const link = zone.getByRole('link', { name: 'ログインして続ける' })
  // Each showing of a kept file has its own token for the sign-in.
  expect(await link.getAttribute('href')).toMatch(
    /^\/login\?to=top&drop=[0-9a-f-]{36}$/,
  )
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

test('F22-AC42: Given a file kept before signing in, When the visitor presses "Sign in to continue" and comes back signed in, Then the file is received by itself and the slide’s page opens', async () => {
  const { page, exchanges } = await pickSignedOut({
    signIn: () => signIn(env, 'alice'),
  })
  const stored = await kept(page)

  await continueLink(page).click()

  await page.waitForURL(`${TEST_ORIGIN}/@alice/kept-talk`, SETTLE)
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

test('F22-AC11: Given a file someone kept and walked away from, When another person signs in from the header and opens the top page, Then nothing is sent in their name, they see the ordinary top page, and the file is not kept for the next visitor', async () => {
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
  // The file is gone: the next visitor who is not signed in, who may be
  // someone else, is not shown its name.
  expect(await kept(page)).toBeNull()
  const visitor = await openPage(browser, env, '/', {
    context: before.page.context(),
  })
  await ready(visitor.page)
  expect(
    await visitor.page.locator(ZONE).getAttribute('data-picked'),
  ).toBeNull()
  expect(writes(visitor.exchanges)).toEqual([])
  await page.context().close()
})

test('F22-AC42: Given someone pressed "continue" and walked away at the login page, When another person signs in from the header in the same tab and opens the top page, Then the file is not received in their name, and it is not kept for the next visitor', async () => {
  const session: { cookie?: string } = {}
  const { page, exchanges } = await pickSignedOut({
    // The sign-in goes nowhere: it is abandoned on the way to the login page.
    down: (_method, path) => path === '/login',
    get cookie() {
      return session.cookie
    },
  })
  await continueLink(page).click()
  await expect
    .poll(
      () => page.evaluate(() => sessionStorage.getItem('slide-drop-continue')),
      SETTLE,
    )
    .not.toBeNull()

  // Someone else signs in from the header, which lands on their slides.
  session.cookie = await signIn(env, 'alice')
  await page.goto(`${TEST_ORIGIN}/`)
  await ready(page)
  await new Promise((resolve) => setTimeout(resolve, 500))

  expect(writes(exchanges)).toEqual([])
  expect(await db.$count(decks)).toBe(0)
  expect(await page.locator(ZONE).getAttribute('data-busy')).toBeNull()
  expect(await kept(page)).toBeNull()
  await page.context().close()
})

test('F22-AC11: Given a kept file, When the top page is opened signed in in another tab before "continue" is pressed, Then the file is forgotten there, and the sign-in comes back to the ordinary top page with nothing sent', async () => {
  const first = await pickSignedOut({ signIn: () => signIn(env, 'alice') })
  const cookie = await signIn(env, 'alice')
  // Another tab of the same browser, already signed in: it has no mark,
  // and whoever is signed in there may not be who kept the file.
  const other = await openPage(browser, env, '/', {
    cookie,
    context: first.page.context(),
  })
  await ready(other.page)
  expect(writes(other.exchanges)).toEqual([])
  await expect.poll(() => kept(other.page), SETTLE).toBeNull()

  // Record every navigation of the tab before pressing "continue": the
  // sign-in can bounce through the login page and back faster than a wait
  // for the login URL can observe, and the tab already sits on the top page.
  const visited: string[] = []
  first.page.on('framenavigated', (frame) => {
    if (frame === first.page.mainFrame()) visited.push(frame.url())
  })
  await continueLink(first.page).click()
  await expect
    .poll(() => {
      const login = visited.findIndex((url) =>
        url.startsWith(`${TEST_ORIGIN}/login`),
      )
      return login >= 0 && visited.slice(login).includes(`${TEST_ORIGIN}/`)
    }, SETTLE)
    .toBe(true)
  await ready(first.page)

  const zone = first.page.locator(ZONE)
  expect(await zone.getAttribute('data-picked')).toBeNull()
  expect(await zone.getAttribute('data-busy')).toBeNull()
  expect(await zone.locator('[role="alert"]').count()).toBe(0)
  expect(writes(first.exchanges)).toEqual([])
  expect(await db.$count(decks)).toBe(0)
  await first.page.context().close()
})

test('F22-AC42: Given the kept file was received after "continue", When the top page is read again in that tab or another, or reached with the back button, Then nothing more is sent', async () => {
  const first = await pickSignedOut({ signIn: () => signIn(env, 'alice') })
  await continueLink(first.page).click()
  await first.page.waitForURL(`${TEST_ORIGIN}/@alice/kept-talk`, SETTLE)
  const cookie = await signIn(env, 'alice')

  const other = await openPage(browser, env, '/', {
    cookie,
    context: first.page.context(),
  })
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

test('F22-AC42: Given the upload after "continue" does not finish, When the author presses "Send again", Then the frame showed the reason with the file, and the same upload goes on to the slide\u2019s page', async () => {
  let failing = true
  const sending = Promise.withResolvers<void>()
  const { page, exchanges } = await pickSignedOut({
    signIn: () => signIn(env, 'alice'),
    down: (method) => failing && method === 'PUT',
    hold: (method) =>
      !failing && method === 'PUT' ? sending.promise : undefined,
  })
  const stored = await kept(page)
  const zone = page.locator(ZONE)

  await continueLink(page).click()
  await expect
    .poll(() => zone.locator('[role="alert"]').textContent(), SETTLE)
    .toBe('受け取りを終えられませんでした。もう一度ドロップしてください。')
  // The file is shown with a way to send it again, not the way to sign in.
  expect(await zone.locator('[data-drop-title]').textContent()).toBe(
    '受け取れませんでした',
  )
  expect(await zone.locator('.drop-file').textContent()).toBe(
    'Kept Talk.html(1 KB)',
  )
  expect(await continueLink(page).isVisible()).toBe(false)
  // The address no longer carries the token of the sign-in.
  expect(page.url()).toBe(`${TEST_ORIGIN}/`)
  // It is held by the page only: the browser keeps it for nobody.
  expect(await kept(page)).toBeNull()

  failing = false
  await zone.getByRole('button', { name: 'もう一度送る' }).click()
  // While it is received, the kept file's block is out of the way.
  await expect.poll(() => zone.getAttribute('data-busy'), SETTLE).toBe('')
  expect(await zone.locator('.drop-picked').isVisible()).toBe(false)
  expect(await zone.getAttribute('data-picked')).toBeNull()
  sending.resolve()

  await page.waitForURL(`${TEST_ORIGIN}/@alice/kept-talk`, SETTLE)
  expect(
    await db
      .select({ state: deployments.state, key: deployments.idempotency_key })
      .from(deployments),
  ).toEqual([{ state: 'ready', key: `new:${OWNER_ID}:${stored?.attempt}` }])
  await page.context().close()
})

test('F22-AC42: Given the upload after "continue" does not finish, When the page is read again, Then the file is not sent a second time by itself, and is not kept for the next visitor', async () => {
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

  expect(writes(exchanges)).toHaveLength(sent)
  expect(await kept(page)).toBeNull()
  expect(await page.locator(ZONE).getAttribute('data-picked')).toBeNull()
  await page.context().close()
})

test('F22-AC9: Given the service has not answered yet who is signed in, When a visitor drops a file, Then nothing about the file is sent: it is kept and the frame asks to sign in', async () => {
  const answered = Promise.withResolvers<void>()
  const { page, exchanges } = await openPage(browser, env, '/', {
    hold: (_method, path) =>
      path === '/api/session' ? answered.promise : undefined,
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
})

test('F22-AC9: Given the service keeps failing to say who is signed in, When a signed-in author drops a file, Then nothing is sent or kept, and the frame says it could not check, not to sign in', async () => {
  const cookie = await signIn(env, 'alice')
  const { page, exchanges } = await openPage(browser, env, '/', {
    cookie,
    down: (_method, path) => path === '/api/session',
  })
  await ready(page)
  const zone = page.locator(ZONE)

  await dropFiles(page, ZONE, [talk])

  await expect
    .poll(() => zone.locator('[role="alert"]').textContent(), SETTLE)
    .toBe(
      'ログインしているかを確かめられませんでした。何も送っていません。しばらくしてから、もう一度お試しください。',
    )
  expect(await zone.getAttribute('data-picked')).toBeNull()
  expect(await continueLink(page).isVisible()).toBe(false)
  expect(await zone.locator('[data-drop-choose]').isVisible()).toBe(true)
  expect(writes(exchanges)).toEqual([])
  expect(await kept(page)).toBeNull()
  expect(await db.$count(decks)).toBe(0)
  await page.context().close()
})

test('F22-AC2: Given the service failed once to say who is signed in, When a signed-in author drops a file, Then it asks once more and receives the file', async () => {
  const cookie = await signIn(env, 'alice')
  let asked = 0
  const { page } = await openPage(browser, env, '/', {
    cookie,
    down: (_method, path) => path === '/api/session' && asked++ === 0,
  })
  await ready(page)

  await dropFiles(page, ZONE, [talk])

  await page.waitForURL(`${TEST_ORIGIN}/@alice/kept-talk`, SETTLE)
  expect(await db.$count(decks)).toBe(1)
  await page.context().close()
})

test('F22-AC42: Given a kept file and "continue" pressed, When the visitor comes back and the service fails to say who is signed in, Then nothing is sent and the frame says so; reading the page again receives the file', async () => {
  let failing = false
  const { page, exchanges } = await pickSignedOut({
    signIn: async () => {
      failing = true
      return signIn(env, 'alice')
    },
    down: (_method, path) => failing && path === '/api/session',
  })
  const zone = page.locator(ZONE)

  await continueLink(page).click()

  await expect
    .poll(() => zone.locator('[role="alert"]').textContent(), SETTLE)
    .toBe(
      'ログインしているかを確かめられませんでした。預かったファイルは、そのままです。しばらくしてから、ページを読み込み直してください。',
    )
  expect(await zone.getAttribute('data-picked')).toBeNull()
  expect(writes(exchanges)).toEqual([])
  expect(await kept(page)).toMatchObject({ name: 'Kept Talk.html' })

  failing = false
  await page.reload()

  await page.waitForURL(`${TEST_ORIGIN}/@alice/kept-talk`, SETTLE)
  expect(await db.$count(decks)).toBe(1)
  await page.context().close()
})

test('F22-AC42: Given the way to sign in from a kept file, When the sign-in finishes, Then the visitor lands on the top page with the token that sign-in carried', async () => {
  const email = emailOf('alice')
  await seedPerson(database, OWNER_ID, 'alice')
  await drizzle(database)
    .insert(accounts)
    .values({ user_id: OWNER_ID, handle: 'alice', created_at: 1 })
    .onConflictDoNothing()
  const form = (path: string, fields: Record<string, string>, cookie = '') =>
    server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: TEST_ORIGIN,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields),
      }),
      env,
    )
  const carried = { to: 'top', drop: RETURN_TOKEN }
  await (await form('/login', { email, ...carried })).text()
  const entered = await form('/login/code', {
    email,
    code: await lastCode(database, email),
    ...carried,
  })
  const cookie =
    entered.headers
      .getSetCookie()
      .find((value) => value.startsWith('__Host-slide_owner='))
      ?.split(';')[0] ?? ''
  expect(cookie).not.toBe('')

  const welcome = await server.fetch(
    new Request(new URL(entered.headers.get('location') ?? '', TEST_ORIGIN), {
      headers: { Cookie: cookie },
    }),
    env,
  )

  // With the token of the press that began it, and nothing else.
  expect(welcome.headers.get('location')).toBe(`/?drop=${RETURN_TOKEN}`)
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

test('F22-AC40: Given a file kept by someone whose address is not invited, When they try to sign in, Then they are told the service is by invitation, they are not signed in, and the kept file is not sent', async () => {
  const before = await pickSignedOut()
  await before.page.close()
  // The sign-in a person outside the registration gets: no session.
  const refused = await signIn(env, 'stranger', {
    id: INVITED_ID,
    invited: false,
  })
  expect(refused).toBe('')
  const told = await server.fetch(new Request(`${TEST_ORIGIN}/login`), env)
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
