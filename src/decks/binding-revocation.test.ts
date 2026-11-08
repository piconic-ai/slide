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
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  signIn,
  testEnv,
  TEST_ORIGIN,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = testEnv(platform.env)
beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db))
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const cookie = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
    ?.split(';')[0] ?? ''
const request = (path: string, init: RequestInit = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, init), env)
const form = (session: string) => ({
  Cookie: session,
  Origin: TEST_ORIGIN,
  'Content-Type': 'application/x-www-form-urlencoded',
})
async function storedBinding() {
  return {
    decks: (await db.prepare('SELECT * FROM decks ORDER BY id').all()).results,
    bindings: (
      await db
        .prepare('SELECT * FROM repository_bindings ORDER BY deck_id')
        .all()
    ).results,
  }
}

for (const existing of [false, true]) {
  test.each(['logout', 'account deletion', 'another login', 'expiry'])(
    `Given ${existing ? 'an existing binding' : 'a new deck'} and repository verification in progress, When %s invalidates its original session, Then no binding or deck is written`,
    async (scenario) => {
      const session = await signIn(env)
      if (existing)
        await db.batch([
          db.prepare(
            "INSERT INTO decks (id, owner_user_id, created_at) VALUES ('talk', '722500', 1)",
          ),
          db.prepare(
            "INSERT INTO repository_bindings VALUES ('talk', 'old-repository', 'old-owner', 'piconic-ai/old', '[\"refs/heads/main\"]', '722500', 1)",
          ),
        ])
      const start = await request('/decks/connect', {
        method: 'POST',
        headers: form(session),
        body: new URLSearchParams({
          deck: 'talk',
          repository: 'piconic-ai/slide',
          branches: 'release',
        }),
      })
      expect(start.status).toBe(303)
      const state = new URL(start.headers.get('location')!).searchParams.get(
        'state',
      )!
      const checking = Promise.withResolvers<void>()
      const verified = Promise.withResolvers<void>()
      const calls: string[] = []
      const stub = () =>
        vi.stubGlobal('fetch', async (input: RequestInfo) => {
          const url = String(input instanceof Request ? input.url : input)
          calls.push(url)
          if (url.endsWith('/access_token'))
            return Response.json({ access_token: 'gho_x' })
          if (url.endsWith('/user/emails')) return Response.json([])
          if (url.endsWith('/user'))
            return Response.json({ id: 722500, login: 'owner' })
          if (url.includes('/repos/')) {
            checking.resolve()
            await verified.promise
            return Response.json({
              id: 1446590227,
              full_name: 'piconic-ai/slide',
              owner: { id: 248307881 },
              permissions: { admin: true },
            })
          }
          return new Response(null, { status: 204 })
        })
      stub()
      const pending = request(`/auth/github/callback?code=c&state=${state}`, {
        headers: {
          Cookie: `${session}; ${cookie(start, '__Host-slide_oauth')}`,
        },
      })
      await checking.promise
      if (scenario === 'logout')
        expect(
          (
            await request('/auth/logout', {
              method: 'POST',
              headers: form(session),
            })
          ).status,
        ).toBe(303)
      if (scenario === 'account deletion')
        expect(
          (
            await request('/account/delete', {
              method: 'POST',
              headers: form(session),
              body: new URLSearchParams({ confirm: 'owner' }),
            })
          ).status,
        ).toBe(303)
      if (scenario === 'another login') {
        await signIn(env)
        stub()
      }
      if (scenario === 'expiry')
        await db
          .prepare('UPDATE auth_session SET expires_at = ?')
          .bind(Date.now() - 1)
          .run()
      const before = await storedBinding()
      const authBefore = await db
        .prepare('SELECT id FROM auth_session ORDER BY id')
        .all()
      verified.resolve()
      const response = await pending
      expect(response.status).toBe(403)
      expect(await storedBinding()).toEqual(before)
      expect(
        (await db.prepare('SELECT id FROM auth_session ORDER BY id').all())
          .results,
      ).toEqual(authBefore.results)
      expect(cookie(response, '__Host-slide_owner')).toBe('')
      expect(calls.at(-1)).toBe(
        'https://api.github.com/applications/Iv1.client/token',
      )
    },
  )
}

test.each(['logout', 'expiry'])(
  'Given a verified repository waiting to write, When %s invalidates the session before the D1 batch executes, Then neither deck nor binding is created',
  async (scenario) => {
    const session = await signIn(env)
    const start = await request('/decks/connect', {
      method: 'POST',
      headers: form(session),
      body: new URLSearchParams({
        deck: 'talk',
        repository: 'piconic-ai/slide',
        branches: 'main',
      }),
    })
    const writing = Promise.withResolvers<void>()
    const proceed = Promise.withResolvers<void>()
    const guarded = new Proxy(db, {
      get(target, key) {
        if (key === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            writing.resolve()
            await proceed.promise
            return target.batch(statements)
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    vi.stubGlobal('fetch', async (input: RequestInfo) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.endsWith('/access_token'))
        return Response.json({ access_token: 'gho_x' })
      if (url.endsWith('/user/emails')) return Response.json([])
      if (url.endsWith('/user'))
        return Response.json({ id: 722500, login: 'owner' })
      if (url.includes('/repos/'))
        return Response.json({
          id: 1446590227,
          full_name: 'piconic-ai/slide',
          owner: { id: 248307881 },
          permissions: { admin: true },
        })
      return new Response(null, { status: 204 })
    })
    const state = new URL(start.headers.get('location')!).searchParams.get(
      'state',
    )!
    const pending = server.fetch(
      new Request(`${TEST_ORIGIN}/auth/github/callback?code=c&state=${state}`, {
        headers: {
          Cookie: `${session}; ${cookie(start, '__Host-slide_oauth')}`,
        },
      }),
      { ...env, DB: guarded },
    )
    await writing.promise
    if (scenario === 'logout')
      expect(
        (
          await request('/auth/logout', {
            method: 'POST',
            headers: form(session),
          })
        ).status,
      ).toBe(303)
    else
      await db
        .prepare('UPDATE auth_session SET expires_at = ?')
        .bind(Date.now() - 1)
        .run()
    proceed.resolve()
    expect((await pending).status).toBe(403)
    expect(await storedBinding()).toEqual({ decks: [], bindings: [] })
  },
)
