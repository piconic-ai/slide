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
import { authSession, authUser } from '../db/auth-schema'
import { accounts } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import server from '../app/routes'
import {
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
beforeEach(() => resetTables(db))
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const handles = async () =>
  orm
    .select({ user_id: accounts.user_id, handle: accounts.handle })
    .from(accounts)

test('Given no account, When the owner signs in, Then the lowercase GitHub login becomes the handle', async () => {
  await signIn(env)
  expect(await handles()).toEqual([{ user_id: '722500', handle: 'owner' }])
})

test('Given the owner signs in again under a renamed GitHub login, When handles are read, Then the first handle stays', async () => {
  await orm
    .insert(accounts)
    .values({ user_id: '722500', handle: 'first', created_at: 1 })
  await signIn(env)
  expect(await handles()).toEqual([{ user_id: '722500', handle: 'first' }])
})

test('Given a login that cannot be a handle, When the owner signs in, Then sign-in succeeds without a handle', async () => {
  expect(await signIn(env, 'not a handle')).toMatch(/^__Host-slide_owner=/)
  expect(await handles()).toEqual([])
})

test('F22-AC26: Given another account already holds the handle, When a person without a handle signs in, Then they get no session or account, land on a page giving the reason and the contact page, and the handle stays with its holder', async () => {
  await orm
    .insert(accounts)
    .values({ user_id: '1', handle: 'owner', created_at: 1 })
  const start = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/github`),
    env,
  )
  const state = new URL(start.headers.get('location') ?? '').searchParams.get(
    'state',
  )
  const requested: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo) => {
    const url = String(input instanceof Request ? input.url : input)
    requested.push(url)
    if (url.endsWith('/user/emails')) return Response.json([])
    if (url.endsWith('/access_token'))
      return Response.json({ access_token: 'gho_x' })
    // GitHub logins compare case-insensitively.
    if (url.endsWith('/user'))
      return Response.json({ id: 722500, login: 'Owner' })
    return new Response(null, { status: 204 })
  })

  const finished = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/github/callback?code=c&state=${state}`, {
      headers: { Cookie: start.headers.getSetCookie()[0]?.split(';')[0] ?? '' },
    }),
    env,
  )

  expect(finished.status).toBe(303)
  expect(finished.headers.get('location')).toBe('/auth/handle-taken')
  expect(
    finished.headers
      .getSetCookie()
      .some((cookie) => /^__Host-slide_owner=[^;]/.test(cookie)),
  ).toBe(false)
  expect(await orm.$count(authUser)).toBe(0)
  expect(await orm.$count(authSession)).toBe(0)
  expect(requested.at(-1)).toContain('/applications/Iv1.client/token')
  expect(await handles()).toEqual([{ user_id: '1', handle: 'owner' }])
  const page = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/handle-taken`),
    env,
  )
  expect(page.status).toBe(200)
  expect(await page.text()).toContain('href="/contact"')
})

test('Given a person who has a handle and renamed their GitHub login to one that is another person’s handle, When they sign in, Then they sign in and both handles stay', async () => {
  await orm.insert(accounts).values([
    { user_id: '722500', handle: 'first', created_at: 1 },
    { user_id: '1', handle: 'owner', created_at: 1 },
  ])

  expect(await signIn(env)).toMatch(/^__Host-slide_owner=/)
  expect(await handles()).toEqual([
    { user_id: '722500', handle: 'first' },
    { user_id: '1', handle: 'owner' },
  ])
})

test('Given an account with a handle, When the owner deletes the account, Then the handle is dropped with it', async () => {
  const cookie = await signIn(env)
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/account/delete`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ confirm: 'owner' }),
    }),
    env,
  )
  expect(response.status).toBe(303)
  expect(await handles()).toEqual([])
})
