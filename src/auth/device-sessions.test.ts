import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { authSession } from '../db/auth-schema'
import { applyMigrations } from '../db/test-migrations'
import {
  emailOf,
  lastCode,
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = testEnv(platform.env)

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db), 30_000)
afterAll(() => platform.dispose())

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'

let sent = 0
const form = (path: string, fields: Record<string, string>, cookie = '') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': fields.agent ?? '',
        // A fresh address each time keeps the site's rate limit out of the way.
        'CF-Connecting-IP': `203.0.113.${(sent = (sent % 250) + 1)}`,
      },
      body: new URLSearchParams(fields),
    }),
    env,
  )

/** Makes the person, invited and welcomed, signed in nowhere yet. */
async function seed(login: string, id = OWNER_ID) {
  await signIn(env, login, { id })
  await orm.delete(authSession).where(eq(authSession.userId, id))
}

/** Signs the owner in through the code, from a browser that says `agent`. */
async function signInFrom(agent: string, login = 'owner') {
  const email = emailOf(login)
  await (await form('/login', { email, agent })).text()
  const code = await lastCode(db, email)
  const entered = await form('/login/code', { email, code, agent })
  return (
    entered.headers
      .getSetCookie()
      .find((value) => value.startsWith('__Host-slide_owner='))
      ?.split(';')[0] ?? ''
  )
}
const visit = (path: string, cookie: string) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: cookie } }),
    env,
  )
const signedIn = async (cookie: string) =>
  (await visit('/auth/owner', cookie)).status === 200
const sessionIdOf = async (device: string) =>
  (await orm
    .select()
    .from(authSession)
    .where(eq(authSession.device, device))
    .get())!.id
/** The settings' list of devices, as text with the tags taken out. */
const devicesOn = async (cookie: string, path = '/settings') => {
  const page = await (await visit(path, cookie)).text()
  const list = page.match(/<ul class="device-list"[\s\S]*?<\/ul>/)?.[0] ?? ''
  return {
    page,
    list,
    text: list.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '),
  }
}

test('F28-AC108: Given the owner signed in on an iPhone and a Mac, When settings open on the Mac, Then both devices are listed with their names and times, and the Mac is this device', async () => {
  await seed('owner')
  const phone = await signInFrom(IPHONE)
  const mac = await signInFrom(MAC)
  const { list, text } = await devicesOn(mac)
  expect(text).toContain('iPhone · Safari')
  expect(text).toContain('Mac · Chrome')
  expect(text).toMatch(/Mac · Chrome この端末/)
  expect(text).toContain('ログイン:')
  expect(text).toContain('最後に使った:')
  expect(list.match(/<time /g)?.length).toBeGreaterThanOrEqual(4)
  // Only the other device has its own button.
  expect(list.match(/action="\/auth\/logout-device"/g)).toHaveLength(1)
  expect(list).toContain(`value="${await sessionIdOf('iPhone · Safari')}"`)
  expect(list).not.toContain(`value="${await sessionIdOf('Mac · Chrome')}"`)
  expect(await signedIn(phone)).toBe(true)
})

test('F28-AC108: Given a device whose sign-in has expired, When settings open, Then it is not listed', async () => {
  await seed('owner')
  await signInFrom(IPHONE)
  const mac = await signInFrom(MAC)
  await orm
    .update(authSession)
    .set({ expiresAt: new Date(1) })
    .where(eq(authSession.device, 'iPhone · Safari'))
  const { text } = await devicesOn(mac)
  expect(text).not.toContain('iPhone')
})

test('F28-AC109: Given the owner on three devices, When they sign out the iPhone from the Mac, Then only the iPhone is signed out', async () => {
  await seed('owner')
  const phone = await signInFrom(IPHONE)
  const mac = await signInFrom(MAC)
  const pc = await signInFrom(WINDOWS)
  const out = await form(
    '/auth/logout-device',
    { session: await sessionIdOf('iPhone · Safari') },
    mac,
  )
  expect(out.status).toBe(303)
  expect(out.headers.get('location')).toBe(
    '/settings?saved=signed-out-device#account',
  )
  expect(await signedIn(phone)).toBe(false)
  expect(await signedIn(mac)).toBe(true)
  expect(await signedIn(pc)).toBe(true)
  const { page, text } = await devicesOn(
    mac,
    '/settings?saved=signed-out-device',
  )
  expect(page).toContain('その端末からログアウトしました。')
  expect(text).not.toContain('iPhone')
})

test.each([
  ['another person’s device', 'theirs'],
  ['no such device', 'no-such-session'],
  ['an empty value', ''],
])(
  'F28-AC110: Given %s, When it is sent to be signed out, Then no sign-in ends',
  async (_, which) => {
    await seed('owner')
    const mine = await signInFrom(IPHONE)
    const mac = await signInFrom(MAC)
    await seed('other', '900')
    const theirs = await signInFrom(WINDOWS, 'other')
    const target =
      which === 'theirs' ? await sessionIdOf('Windows · Edge') : which
    const out = await form('/auth/logout-device', { session: target }, mac)
    expect(out.status).toBe(303)
    expect(await signedIn(mine)).toBe(true)
    expect(await signedIn(mac)).toBe(true)
    expect(await signedIn(theirs)).toBe(true)
  },
)

test.each([
  ['another origin', 'https://evil.example', 403],
  ['no sign-in', TEST_ORIGIN, 401],
])(
  'F28-AC110: Given %s, When a device is sent to be signed out, Then it is refused and the device stays signed in',
  async (_, origin, status) => {
    await seed('owner')
    const phone = await signInFrom(IPHONE)
    const mac = await signInFrom(MAC)
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}/auth/logout-device`, {
        method: 'POST',
        headers: {
          Cookie: status === 401 ? '' : mac,
          Origin: origin,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          session: await sessionIdOf('iPhone · Safari'),
        }),
      }),
      env,
    )
    expect(response.status).toBe(status)
    expect(await signedIn(phone)).toBe(true)
  },
)

test('F28-AC111: Given a sign-in from an iPhone, When the session is stored, Then only the rough name is kept, with no user agent and no address', async () => {
  await seed('owner')
  await signInFrom(IPHONE)
  const row = await orm
    .select()
    .from(authSession)
    .where(eq(authSession.device, 'iPhone · Safari'))
    .get()
  expect(row).toMatchObject({
    userId: OWNER_ID,
    device: 'iPhone · Safari',
    userAgent: null,
    ipAddress: null,
  })
})

test('F28-AC111: Given a sign-in from an agent nobody knows, When settings open, Then it shows as an unknown device', async () => {
  await seed('owner')
  const unknown = await signInFrom('curl/8.7.1')
  await signInFrom(MAC)
  const row = await orm
    .select()
    .from(authSession)
    .where(eq(authSession.userAgent, 'curl/8.7.1'))
    .get()
  expect(row).toBeUndefined()
  const { text } = await devicesOn(unknown)
  expect(text).toMatch(/不明な端末 この端末/)
})
