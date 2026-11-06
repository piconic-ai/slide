import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../db/test-migrations'
import { authRoutes } from './routes'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = {
  ...platform.env,
  GITHUB_APP_CLIENT_ID: 'Iv1.client',
  GITHUB_APP_CLIENT_SECRET: 'secret',
  PUBLIC_ORIGIN: 'https://slide.example',
} as unknown as Env
const origin = 'https://slide.example'

beforeAll(() => applyMigrations(platform.env.DB))
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

/** Replaces GitHub's token and user endpoints; other URLs fail the test. */
function stubGitHub(user: unknown, token: unknown = { access_token: 'gho_x' }) {
  const calls: { url: string; body?: unknown }[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push({ url, body: init?.body && JSON.parse(String(init.body)) })
    if (url === 'https://github.com/login/oauth/access_token')
      return token instanceof Response ? token : Response.json(token)
    if (url === 'https://api.github.com/user')
      return user instanceof Response ? user : Response.json(user)
    if (url === 'https://api.github.com/applications/Iv1.client/token')
      return new Response(null, { status: 204 })
    throw new Error(`Unexpected fetch ${url}`)
  })
  return calls
}

const cookieValue = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(';')[0]
    ?.slice(name.length + 1)

async function login(user: unknown) {
  const start = await authRoutes.request(`${origin}/github`, {}, env)
  expect(start.status).toBe(303)
  const location = new URL(start.headers.get('location') ?? '')
  const oauth = cookieValue(start, '__Host-slide_oauth')
  const calls = stubGitHub(user)
  const callback = await authRoutes.request(
    `${origin}/github/callback?code=abc&state=${location.searchParams.get('state')}`,
    { headers: { Cookie: `__Host-slide_oauth=${oauth}` } },
    env,
  )
  return { start, callback, calls, oauth }
}

test('given the owner account, when GitHub login completes, then a host-only owner session is issued', async () => {
  const { start, callback, calls, oauth } = await login({
    id: 722500,
    login: 'owner',
  })
  const cookie = start.headers
    .getSetCookie()
    .find((value) => value.startsWith('__Host-slide_oauth='))
  expect(cookie).toMatch(/HttpOnly/)
  expect(cookie).toMatch(/Secure/)
  expect(cookie).toMatch(/SameSite=Lax/)
  expect(callback.status).toBe(302)
  const verifier = oauth?.split('.')[1]
  expect(calls[0]?.body).toMatchObject({
    client_id: 'Iv1.client',
    code: 'abc',
    code_verifier: verifier,
    redirect_uri: `${origin}/auth/github/callback`,
  })
  const session = cookieValue(callback, '__Host-slide_owner')
  expect(session).toMatch(/^[A-Za-z0-9_-]{43}$/)
  const ownerCookie = callback.headers
    .getSetCookie()
    .find((value) => value.startsWith('__Host-slide_owner='))
  expect(ownerCookie).toMatch(/Max-Age=43200/)
  expect(ownerCookie).toMatch(/Path=\//)
  expect(ownerCookie).toMatch(/HttpOnly/)
  expect(ownerCookie).toMatch(/Secure/)
  expect(ownerCookie).toMatch(/SameSite=Lax/)
  expect(ownerCookie).not.toMatch(/Domain=/)
  expect(calls.at(-1)?.url).toBe(
    'https://api.github.com/applications/Iv1.client/token',
  )
  expect(calls.at(-1)?.body).toEqual({ access_token: 'gho_x' })
  const owner = await authRoutes.request(
    `${origin}/owner`,
    { headers: { Cookie: `__Host-slide_owner=${session}` } },
    env,
  )
  expect(await owner.json()).toEqual({ userId: '722500', login: 'owner' })
  const stored = await platform.env.DB.prepare(
    'SELECT token_hash FROM owner_sessions',
  ).all<{ token_hash: string }>()
  expect(stored.results.map(({ token_hash }) => token_hash)).not.toContain(
    session,
  )
})

test('given another GitHub account, when login completes, then no session is issued', async () => {
  const { callback } = await login({ id: 1, login: 'someone' })
  expect(callback.status).toBe(403)
  expect(cookieValue(callback, '__Host-slide_owner')).toBeUndefined()
})

test.each([
  ['a mismatched state', (state: string) => `code=abc&state=${state}x`],
  ['a missing code', (state: string) => `state=${state}`],
])(
  'given %s, when the callback runs, then GitHub is not called',
  async (_name, query) => {
    const start = await authRoutes.request(`${origin}/github`, {}, env)
    const state = new URL(start.headers.get('location') ?? '').searchParams.get(
      'state',
    )
    const calls = stubGitHub({ id: 722500, login: 'owner' })
    const response = await authRoutes.request(
      `${origin}/github/callback?${query(state ?? '')}`,
      {
        headers: {
          Cookie: `__Host-slide_oauth=${cookieValue(start, '__Host-slide_oauth')}`,
        },
      },
      env,
    )
    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  },
)

test('given GitHub refuses the code, when the callback runs, then login fails without a session', async () => {
  const start = await authRoutes.request(`${origin}/github`, {}, env)
  const state = new URL(start.headers.get('location') ?? '').searchParams.get(
    'state',
  )
  stubGitHub({ id: 722500, login: 'owner' }, { error: 'bad_verification_code' })
  const response = await authRoutes.request(
    `${origin}/github/callback?code=abc&state=${state}`,
    {
      headers: {
        Cookie: `__Host-slide_oauth=${cookieValue(start, '__Host-slide_oauth')}`,
      },
    },
    env,
  )
  expect(response.status).toBe(502)
  expect(cookieValue(response, '__Host-slide_owner')).toBeUndefined()
})

test('given an owner session, when logout is posted cross-site or same-site, then only same-site logout ends it', async () => {
  const { callback } = await login({ id: 722500, login: 'owner' })
  const session = cookieValue(callback, '__Host-slide_owner')
  const headers = (from: string) => ({
    Cookie: `__Host-slide_owner=${session}`,
    Origin: from,
    'Content-Type': 'application/x-www-form-urlencoded',
  })
  const owner = () =>
    authRoutes.request(
      `${origin}/owner`,
      { headers: { Cookie: `__Host-slide_owner=${session}` } },
      env,
    )
  const forged = await authRoutes.request(
    `${origin}/logout`,
    { method: 'POST', headers: headers('https://evil.example') },
    env,
  )
  expect(forged.status).toBe(403)
  expect((await owner()).status).toBe(200)
  const logout = await authRoutes.request(
    `${origin}/logout`,
    { method: 'POST', headers: headers(origin) },
    env,
  )
  expect(logout.status).toBe(303)
  expect(
    logout.headers
      .getSetCookie()
      .find((value) => value.startsWith('__Host-slide_owner=')),
  ).toMatch(/Max-Age=0/)
  expect((await owner()).status).toBe(401)
})

test.each([
  ['expired', 'UPDATE owner_sessions SET expires_at = 1, created_at = 0'],
  ['no longer allowed', "UPDATE owner_sessions SET github_user_id = '1'"],
])(
  'given a session that is %s, when the owner is read, then it is rejected',
  async (_name, update) => {
    const { callback } = await login({ id: 722500, login: 'owner' })
    const session = cookieValue(callback, '__Host-slide_owner')
    await platform.env.DB.prepare(update).run()
    const response = await authRoutes.request(
      `${origin}/owner`,
      { headers: { Cookie: `__Host-slide_owner=${session}` } },
      env,
    )
    expect(response.status).toBe(401)
  },
)

test('given login is not configured, when it starts, then it is unavailable', async () => {
  const response = await authRoutes.request(`${origin}/github`, {}, {
    ...platform.env,
    GITHUB_APP_CLIENT_ID: '',
  } as Env)
  expect(response.status).toBe(503)
})

async function callbackWith(
  query: string,
  cookie: string | undefined,
  target: Env = env,
) {
  return authRoutes.request(
    `${origin}/github/callback?${query}`,
    cookie ? { headers: { Cookie: `__Host-slide_oauth=${cookie}` } } : {},
    target,
  )
}

async function startedLogin() {
  const start = await authRoutes.request(`${origin}/github`, {}, env)
  const state =
    new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? ''
  return { state, cookie: cookieValue(start, '__Host-slide_oauth') }
}

test.each([
  ['no OAuth cookie', undefined],
  ['a malformed OAuth cookie', 'not-a-start'],
])(
  'given %s, when the callback runs, then login restarts',
  async (_n, cookie) => {
    const calls = stubGitHub({ id: 722500, login: 'owner' })
    expect((await callbackWith('code=abc&state=x', cookie)).status).toBe(400)
    expect(calls).toEqual([])
  },
)

test.each([
  ['a failing user endpoint', new Response('no', { status: 500 }), undefined],
  ['an invalid user body', new Response('<html>'), undefined],
  ['a user without an ID', { login: 'owner' }, undefined],
  ['a non-JSON token body', {}, new Response('<html>')],
])(
  'given %s, when the callback runs, then login fails without a session',
  async (_name, user, token) => {
    const { state, cookie } = await startedLogin()
    stubGitHub(user, token)
    const response = await callbackWith(`code=abc&state=${state}`, cookie)
    expect(response.status).toBe(502)
    expect(cookieValue(response, '__Host-slide_owner')).toBeUndefined()
  },
)

test('given the user denies access on GitHub, when the callback runs, then it says so', async () => {
  const { state, cookie } = await startedLogin()
  const calls = stubGitHub({ id: 722500, login: 'owner' })
  const response = await callbackWith(
    `error=access_denied&state=${state}`,
    cookie,
  )
  expect(response.status).toBe(403)
  expect(calls).toEqual([])
})

test('given login is not configured, when the callback runs, then it is unavailable', async () => {
  const response = await callbackWith('code=abc&state=x', undefined, {
    ...platform.env,
    GITHUB_APP_CLIENT_ID: '',
  } as unknown as Env)
  expect(response.status).toBe(503)
})

test('given an existing session, when the owner logs in again, then the earlier session ends', async () => {
  const first = cookieValue(
    (await login({ id: 722500, login: 'owner' })).callback,
    '__Host-slide_owner',
  )
  const second = cookieValue(
    (await login({ id: 722500, login: 'owner' })).callback,
    '__Host-slide_owner',
  )
  const read = (session: string | undefined) =>
    authRoutes.request(
      `${origin}/owner`,
      { headers: { Cookie: `__Host-slide_owner=${session}` } },
      env,
    )
  expect((await read(first)).status).toBe(401)
  expect((await read(second)).status).toBe(200)
})
