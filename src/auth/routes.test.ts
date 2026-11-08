import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import { Hono } from 'hono'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  testEnv,
  TEST_ORIGIN as origin,
} from '../publication/test-support'
import { authRoutes } from './routes'
const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
const db = platform.env.DB
const app = new Hono<{ Bindings: Env }>().route('/auth', authRoutes)
beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db))
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())
const request = (path: string, init: RequestInit = {}, target = env) =>
  app.request(`${origin}/auth${path}`, init, target)
const cookie = (response: Response, name = '__Host-slide_owner') =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
    ?.split(';')[0] ?? ''
function stubGitHub(
  user: unknown = { id: 722500, login: 'owner' },
  privateEmails = true,
) {
  const calls: { url: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const body = init?.body ? String(init.body) : ''
    calls.push({ url, body })
    if (url.endsWith('/access_token'))
      return Response.json({
        access_token: 'gho_x',
        refresh_token: 'ghr_secret',
        id_token: 'id_secret',
      })
    if (url.endsWith('/user')) return Response.json(user)
    if (url.endsWith('/user/emails'))
      return privateEmails
        ? Response.json([])
        : Response.json(
            { message: 'Resource not accessible by integration' },
            { status: 403 },
          )
    if (url.endsWith('/token')) return new Response(null, { status: 204 })
    throw new Error(`Unexpected GitHub request ${url}`)
  })
  return calls
}
async function begin() {
  const start = await request('/github')
  expect(start.status).toBe(303)
  return {
    start,
    state: new URL(start.headers.get('location')!).searchParams.get('state')!,
    oauth: cookie(start, '__Host-slide_oauth'),
  }
}
const callback = (state: string, oauth: string, query = 'code=c') =>
  request(`/github/callback?${query}&state=${encodeURIComponent(state)}`, {
    headers: { Cookie: oauth },
  })
async function login(user?: unknown) {
  const started = await begin()
  const calls = stubGitHub(user)
  const response = await callback(started.state, started.oauth)
  return { ...started, response, calls, session: cookie(response) }
}
const owner = (session: string, target = env) =>
  request('/owner', { headers: { Cookie: session } }, target)

test('Given the permitted GitHub owner, When login completes, Then a host-only 12-hour library session is issued without persisting provider tokens', async () => {
  const { start, response, calls, session } = await login()
  expect(response.status).toBe(302)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(
    new URL(start.headers.get('location')!).searchParams.get(
      'code_challenge_method',
    ),
  ).toBe('S256')
  const attributes = response.headers
    .getSetCookie()
    .find((value) => value.startsWith('__Host-slide_owner='))!
  for (const value of [
    'Secure',
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=43200',
  ])
    expect(attributes).toContain(value)
  expect(attributes).not.toContain('Domain=')
  expect(await (await owner(session)).json()).toEqual({
    userId: '722500',
    login: 'owner',
  })
  expect(
    (
      await db
        .prepare(
          'SELECT access_token, refresh_token, id_token FROM auth_account',
        )
        .all()
    ).results,
  ).toEqual([{ access_token: null, refresh_token: null, id_token: null }])
  expect(
    await db.prepare('SELECT ip_address, user_agent FROM auth_session').first(),
  ).toEqual({ ip_address: null, user_agent: null })
  expect(calls.at(-1)).toMatchObject({
    url: 'https://api.github.com/applications/Iv1.client/token',
  })
  expect(JSON.parse(String(calls.at(-1)?.body))).toEqual({
    access_token: 'gho_x',
  })
})
test('Given another GitHub account, When the callback returns, Then no auth user or session is created and the token is revoked', async () => {
  const { response, calls } = await login({ id: 1, login: 'other' })
  expect(cookie(response)).toBe('')
  expect(
    (await db.prepare('SELECT COUNT(*) AS n FROM auth_user').first())?.n,
  ).toBe(0)
  expect(calls.at(-1)?.url).toContain('/token')
})
test.each(['mismatch', 'missing-cookie', 'missing-code', 'denied', 'expired'])(
  'Given %s OAuth state, When callback runs, Then GitHub is not called and no session is issued',
  async (scenario) => {
    const { state, oauth } = await begin()
    if (scenario === 'expired')
      await db
        .prepare(
          "UPDATE auth_verification SET expires_at = 1, value = json_set(value, '$.expiresAt', 1)",
        )
        .run()
    const calls = stubGitHub()
    const response = await callback(
      scenario === 'mismatch' ? `${state}x` : state,
      scenario === 'missing-cookie' ? '' : oauth,
      scenario === 'missing-code'
        ? ''
        : scenario === 'denied'
          ? 'error=access_denied'
          : 'code=c',
    )
    expect(cookie(response)).toBe('')
    expect(calls).toEqual([])
  },
)
test('Given consumed OAuth state, When it is replayed, Then no token exchange or session replacement occurs', async () => {
  const first = await login()
  const calls = stubGitHub()
  expect(cookie(await callback(first.state, first.oauth))).toBe('')
  expect(calls).toEqual([])
  expect((await owner(first.session)).status).toBe(200)
})
test('Given an owner session, When logout is posted across origins, Then only the configured origin may revoke it', async () => {
  const { session } = await login()
  const logout = (from: string) =>
    request('/logout', {
      method: 'POST',
      headers: {
        Cookie: session,
        Origin: from,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
  expect((await logout('https://evil.example')).status).toBe(403)
  expect((await owner(session)).status).toBe(200)
  expect((await logout(origin)).status).toBe(303)
  expect((await owner(session)).status).toBe(401)
})
test('Given an expired, tampered or no-longer-allowed owner session, When a protected request runs, Then access is refused', async () => {
  const { session } = await login()
  expect((await owner(`${session}x`)).status).toBe(401)
  expect(
    (await owner(session, { ...env, GITHUB_ACTOR_ID: '1' } as unknown as Env))
      .status,
  ).toBe(401)
  await db.prepare('UPDATE auth_session SET expires_at = 1').run()
  expect((await owner(session)).status).toBe(401)
})
test('Given an existing session, When the owner signs in again, Then the earlier session is invalidated', async () => {
  const first = await login()
  const second = await login()
  expect((await owner(first.session)).status).toBe(401)
  expect((await owner(second.session)).status).toBe(200)
})
test('Given concurrent owner logins, When both callbacks finish, Then exactly one session remains valid', async () => {
  await login()
  const a = await begin()
  const b = await begin()
  stubGitHub()
  const responses = await Promise.all([
    callback(a.state, a.oauth),
    callback(b.state, b.oauth),
  ])
  const statuses = await Promise.all(
    responses.map(async (response) => (await owner(cookie(response))).status),
  )
  expect(statuses.filter((status) => status === 200).length).toBe(1)
})
test('Given missing or short auth secret, When login starts, Then it fails closed', async () => {
  for (const secret of ['', 'short'])
    expect(
      (await request('/github', {}, { ...env, BETTER_AUTH_SECRET: secret }))
        .status,
    ).toBe(503)
})
test('Given a direct unwanted authentication endpoint, When it is requested, Then it cannot bypass Slide authorization', async () => {
  for (const path of [
    '/sign-in/social',
    '/update-user',
    '/link-social',
    '/delete-user',
    '/callback/github',
  ])
    expect((await request(path, { method: 'POST' })).status).toBe(404)
})

test('Given a GitHub App without private email permission, When login completes, Then the immutable GitHub identity is sufficient', async () => {
  const { state, oauth } = await begin()
  stubGitHub({ id: 722500, login: 'owner' }, false)
  const response = await callback(state, oauth)
  expect(response.status).toBe(302)
  expect((await owner(cookie(response))).status).toBe(200)
  expect((await db.prepare('SELECT email FROM auth_user').first())?.email).toBe(
    '722500@users.noreply.github.com',
  )
})

test('Given a transient D1 failure while creating the provider account, When the same verified owner retries, Then login recovers without duplicate users', async () => {
  let failAccountInsert = true
  const interrupted = new Proxy(db, {
    get(target, key) {
      if (key === 'prepare')
        return (sql: string) => {
          if (failAccountInsert && /insert into "auth_account"/i.test(sql)) {
            failAccountInsert = false
            throw new Error('Injected one-time account insert failure')
          }
          return target.prepare(sql)
        }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const { state, oauth } = await begin()
  stubGitHub()
  const failed = await request(
    `/github/callback?code=c&state=${state}`,
    { headers: { Cookie: oauth } },
    { ...env, DB: interrupted },
  )
  expect(cookie(failed)).toBe('')
  expect(
    (await db.prepare('SELECT COUNT(*) AS n FROM auth_user').first())?.n,
  ).toBe(1)
  expect(
    (await db.prepare('SELECT COUNT(*) AS n FROM auth_account').first())?.n,
  ).toBe(0)
  const retried = await login()
  expect((await owner(retried.session)).status).toBe(200)
  expect(
    (await db.prepare('SELECT COUNT(*) AS n FROM auth_user').first())?.n,
  ).toBe(1)
  expect(
    (await db.prepare('SELECT COUNT(*) AS n FROM auth_account').first())?.n,
  ).toBe(1)
})

test('Given an orphan user for another GitHub ID, When that disallowed account signs in, Then recovery cannot bypass the allowlist', async () => {
  await db
    .prepare(
      "INSERT INTO auth_user VALUES ('orphan', 'other', '1@users.noreply.github.com', 0, NULL, 1, 1)",
    )
    .run()
  const { response } = await login({ id: 1, login: 'other' })
  expect(cookie(response)).toBe('')
  expect(
    (await db.prepare('SELECT COUNT(*) AS n FROM auth_account').first())?.n,
  ).toBe(0)
  expect(
    (await db.prepare('SELECT COUNT(*) AS n FROM auth_session').first())?.n,
  ).toBe(0)
  expect(
    (await db.prepare('SELECT COUNT(*) AS n FROM auth_user').first())?.n,
  ).toBe(1)
})
