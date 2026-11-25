import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { authSession } from '../db/auth-schema'
import { invitedEmails } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { squarePng } from '../profile/test-picture'
import {
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

const HOUR = 60 * 60 * 1000

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db), 30_000)
afterEach(() => vi.useRealTimers())
afterAll(() => platform.dispose())

const visit = (path: string, cookie: string) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: cookie } }),
    env,
  )
const post = (path: string, cookie: string) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(),
    }),
    env,
  )
const signedIn = async (cookie: string) =>
  (await visit('/auth/owner', cookie)).status === 200
const ownerCookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith('__Host-slide_owner='))

/** Moves the clock the service and Better Auth read, leaving timers alone. */
function clockAt(time: number) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(time)
}

test('F28-AC102: Given a person signed in on a PC, When they also sign in on a phone, Then both devices stay signed in', async () => {
  const pc = await signIn(env, 'owner')
  const phone = await signIn(env, 'owner')
  expect(await signedIn(pc)).toBe(true)
  expect(await signedIn(phone)).toBe(true)
  expect(await orm.$count(authSession)).toBe(2)
})

test('F28-AC103: Given a person who keeps using the service every 23 hours, When three days pass since signing in, Then they are still signed in and the cookie is renewed', async () => {
  const start = Date.now()
  clockAt(start)
  const cookie = await signIn(env, 'owner')
  for (let step = 1; step <= 3; step++) {
    clockAt(start + step * 23 * HOUR)
    const response = await visit('/auth/owner', cookie)
    expect(response.status, `after ${step * 23} hours`).toBe(200)
    expect(ownerCookieOf(response)).toMatch(/Max-Age=86400/)
  }
})

test.each(['/', `/avatars/${OWNER_ID}`, '/settings'])(
  'F28-AC103: Given a session last renewed 23 hours ago, When %s is opened, Then the renewed cookie comes back with it',
  async (path) => {
    const start = Date.now()
    clockAt(start)
    const cookie = await signIn(env, 'owner')
    clockAt(start + 23 * HOUR)
    const response = await visit(path, cookie)
    // A person with no picture gets 404 (their initial); that answer counts too.
    await response.arrayBuffer()
    const renewed = response.headers
      .getSetCookie()
      .filter((value) => value.startsWith('__Host-slide_owner='))
    expect(renewed).toHaveLength(1)
    expect(renewed[0]).toMatch(/Max-Age=86400/)
    const cacheControl = response.headers.get('cache-control') ?? ''
    expect(cacheControl).toContain('private, no-store')
    if (response.headers.get('content-type')?.startsWith('text/html'))
      expect(cacheControl).toContain('no-transform')
  },
)

test('F28-AC103: Given an uploaded picture kept for a year under its version, When it is fetched with a session due for renewal, Then the renewed cookie comes with no shared caching', async () => {
  const start = Date.now()
  clockAt(start)
  const cookie = await signIn(env, 'owner', { name: 'Owner' })
  const form = new FormData()
  form.set('picture', new File([squarePng() as BlobPart], 'face.png'))
  const uploaded = await server.fetch(
    new Request(`${TEST_ORIGIN}/settings/picture`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: TEST_ORIGIN },
      body: form,
    }),
    env,
  )
  expect(uploaded.status).toBe(303)
  const { avatarUrl } = (await (
    await visit('/api/session', cookie)
  ).json()) as {
    avatarUrl: string
  }
  // Without a renewal, the versioned picture may be kept anywhere.
  const shared = await server.fetch(
    new Request(`${TEST_ORIGIN}${avatarUrl}`),
    env,
  )
  await shared.arrayBuffer()
  expect(shared.headers.get('cache-control')).toContain('public')

  clockAt(start + 2 * HOUR)
  const response = await visit(avatarUrl, cookie)
  await response.arrayBuffer()
  expect(response.status).toBe(200)
  expect(ownerCookieOf(response)).toMatch(/Max-Age=86400/)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})

test('Given a session that another device ends while this request renews it, When the page is opened, Then it reads as signed out instead of failing', async () => {
  const start = Date.now()
  clockAt(start)
  const cookie = await signIn(env, 'owner')
  clockAt(start + 2 * HOUR)
  // The renewal finds no row, as when the row went between read and write.
  const racing = new Proxy(db, {
    get(target, key) {
      if (key === 'prepare')
        return (query: string) =>
          target.prepare(
            /^update "auth_session"/i.test(query)
              ? query.replace(/ where /i, ' where 0 and ')
              : query,
          )
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/settings`, { headers: { Cookie: cookie } }),
    { ...env, DB: racing },
  )
  expect(response.status).toBe(401)
})

test('F28-AC104: Given a session renewed less than an hour ago, When it is used again, Then it is not renewed again', async () => {
  const start = Date.now()
  clockAt(start)
  const cookie = await signIn(env, 'owner')
  clockAt(start + 59 * 60 * 1000)
  const response = await visit('/auth/owner', cookie)
  expect(response.status).toBe(200)
  expect(ownerCookieOf(response)).toBeUndefined()
})

test.each([
  [24 * HOUR + 1000, false],
  [24 * HOUR - 1000, true],
])(
  'F28-AC104: Given a session left unused, When %i ms pass since it was last extended, Then signed in is %s',
  async (idle, expected) => {
    const start = Date.now()
    clockAt(start)
    const cookie = await signIn(env, 'owner')
    clockAt(start + idle)
    expect(await signedIn(cookie)).toBe(expected)
  },
)

test('F28-AC105: Given a person signed in on two devices, When they sign out on one, Then only that device is signed out', async () => {
  const pc = await signIn(env, 'owner')
  const phone = await signIn(env, 'owner')
  expect((await post('/auth/logout', pc)).status).toBe(303)
  expect(await signedIn(pc)).toBe(false)
  expect(await signedIn(phone)).toBe(true)
})

test('F28-AC107: Given a person signed in on two devices, When the operator takes their address off the invitations, Then both devices are signed out', async () => {
  const pc = await signIn(env, 'owner')
  const phone = await signIn(env, 'owner')
  await orm.delete(invitedEmails)
  expect(await signedIn(pc)).toBe(false)
  expect(await signedIn(phone)).toBe(false)
  expect(await orm.$count(authSession, eq(authSession.userId, OWNER_ID))).toBe(
    0,
  )
})

test('F28-AC107: Given a person signed in on two devices, When they delete their account on one, Then both devices are signed out', async () => {
  const pc = await signIn(env, 'owner')
  const phone = await signIn(env, 'owner')
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/account/delete`, {
      method: 'POST',
      headers: {
        Cookie: pc,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ confirm: 'owner' }),
    }),
    env,
  )
  expect(response.status).toBe(303)
  expect(await signedIn(pc)).toBe(false)
  expect(await signedIn(phone)).toBe(false)
})
