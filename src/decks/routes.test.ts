import { signIn as sharedSignIn } from '../publication/test-support'
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
import { DEFAULT_UPLOAD_LIMITS } from '../uploads/limits'

const platform = await getPlatformProxy<Env>({ persist: false })
const origin = 'https://slide.example'
const env = {
  ...platform.env,
  GITHUB_APP_CLIENT_ID: 'Iv1.client',
  GITHUB_APP_CLIENT_SECRET: 'secret',
  BETTER_AUTH_SECRET: 'test-only-better-auth-secret-32-bytes-long',
  PUBLIC_ORIGIN: origin,
} as unknown as Env
const owner = { id: 722500, login: 'owner' }
const repository = (admin: boolean) => ({
  id: 1446590227,
  full_name: 'piconic-ai/slide',
  owner: { id: 248307881 },
  permissions: { admin },
})

beforeAll(() => applyMigrations(platform.env.DB))
beforeEach(async () => {
  await platform.env.DB.batch([
    platform.env.DB.prepare('DELETE FROM repository_bindings'),
    platform.env.DB.prepare('DELETE FROM decks'),
    platform.env.DB.prepare('DELETE FROM auth_session'),
  ])
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

function stubGitHub(repo: unknown, user = owner) {
  const requested: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo) => {
    const url = String(input instanceof Request ? input.url : input)
    requested.push(url)
    if (url.endsWith('/user/emails')) return Response.json([])
    if (url === 'https://github.com/login/oauth/access_token')
      return Response.json({ access_token: 'gho_x' })
    if (url === 'https://api.github.com/user') return Response.json(user)
    if (url.startsWith('https://api.github.com/repos/'))
      return repo ? Response.json(repo) : new Response('{}', { status: 404 })
    return new Response(null, { status: 204 })
  })
  return requested
}

const request = (path: string, init: RequestInit = {}) =>
  server.fetch(new Request(`${origin}${path}`, init), env)

const cookieValue = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(';')[0]

const signIn = () => sharedSignIn(env)

async function connect(
  session: string,
  form: Record<string, string>,
  repo: unknown,
) {
  const start = await request('/decks/connect', {
    method: 'POST',
    headers: {
      Cookie: session,
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form),
  })
  if (start.status !== 303) return { start, callback: start, requested: [] }
  const state = new URL(start.headers.get('location') ?? '').searchParams.get(
    'state',
  )
  const requested = stubGitHub(repo)
  const callback = await request(
    `/auth/github/callback?code=c&state=${state}`,
    {
      headers: {
        Cookie: `${session}; ${cookieValue(start, '__Host-slide_oauth')}`,
      },
    },
  )
  return { start, callback, requested }
}

const form = {
  deck: 'talk',
  repository: 'piconic-ai/slide',
  branches: 'main, release',
}
const listDecks = (session: string) =>
  request('/api/decks', { headers: { Cookie: session } })

test('given the signed-in owner administers the repository, when a deck is connected, then the verified binding is stored', async () => {
  const session = await signIn()
  const { start, callback, requested } = await connect(
    session,
    form,
    repository(true),
  )
  expect(new URL(start.headers.get('location') ?? '').origin).toBe(
    'https://github.com',
  )
  expect(callback.status).toBe(302)
  expect(requested).toContain('https://api.github.com/repos/piconic-ai/slide')
  expect(await (await listDecks(session)).json()).toEqual({
    decks: [
      {
        deck: 'talk',
        repository: 'piconic-ai/slide',
        repositoryId: '1446590227',
        allowedRefs: ['refs/heads/main', 'refs/heads/release'],
        verifiedAt: expect.any(Number),
      },
    ],
  })
})

test.each([
  ['without admin permission', repository(false), 403],
  ['that the app cannot see', null, 404],
])(
  'given a repository %s, when a deck is connected, then nothing is stored',
  async (_name, repo, status) => {
    const session = await signIn()
    const { callback } = await connect(session, form, repo)
    expect(callback.status).toBe(status)
    expect(await (await listDecks(session)).json()).toEqual({ decks: [] })
  },
)

test('given a deck owned by someone else, when it is connected, then the binding is refused', async () => {
  await platform.env.DB.prepare(
    "INSERT INTO decks (id, owner_user_id, created_at) VALUES ('talk', '1', 1)",
  ).run()
  const session = await signIn()
  const { callback } = await connect(session, form, repository(true))
  expect(callback.status).toBe(409)
  const bindings = await platform.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM repository_bindings',
  ).first<{ count: number }>()
  expect(bindings?.count).toBe(0)
})

test('given the owner already has the default number of decks, when a new deck is connected, then it is refused without a binding', async () => {
  const { decks } = DEFAULT_UPLOAD_LIMITS
  await platform.env.DB.batch(
    Array.from({ length: decks }, (_, index) =>
      platform.env.DB.prepare(
        "INSERT INTO decks (id, owner_user_id, created_at) VALUES (?, '722500', 1)",
      ).bind(`existing-${index}`),
    ),
  )
  const session = await signIn()
  const { callback } = await connect(session, form, repository(true))
  expect(callback.status).toBe(409)
  expect(await callback.text()).toContain('Deck limit reached')
  const created = await platform.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM decks WHERE id = 'talk'",
  ).first<{ count: number }>()
  expect(created?.count).toBe(0)
})

test('given an existing binding, when the owner connects again, then the branches are replaced', async () => {
  const session = await signIn()
  await connect(session, form, repository(true))
  await connect(session, { ...form, branches: 'slides' }, repository(true))
  const body = (await (await listDecks(session)).json()) as {
    decks: { allowedRefs: string[] }[]
  }
  expect(body.decks.map(({ allowedRefs }) => allowedRefs)).toEqual([
    ['refs/heads/slides'],
  ])
})

test.each([
  ['no owner session', '', origin, form, 401],
  ['a cross-site form', 'session', 'https://evil.example', form, 403],
  [
    'an invalid repository',
    'session',
    origin,
    { ...form, repository: 'x' },
    400,
  ],
  ['no branches', 'session', origin, { ...form, branches: ' ' }, 400],
])(
  'given %s, when connect is posted, then GitHub is not involved',
  async (_name, withSession, from, body, status) => {
    const session = withSession ? await signIn() : ''
    const response = await request('/decks/connect', {
      method: 'POST',
      headers: {
        Cookie: session,
        Origin: from,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body),
    })
    expect(response.status).toBe(status)
  },
)

test('given a bind authorization without an owner session, when the callback runs, then nothing is stored', async () => {
  const session = await signIn()
  const start = await request('/decks/connect', {
    method: 'POST',
    headers: {
      Cookie: session,
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form),
  })
  const state = new URL(start.headers.get('location') ?? '').searchParams.get(
    'state',
  )
  await platform.env.DB.prepare('DELETE FROM auth_session').run()
  stubGitHub(repository(true))
  const callback = await request(
    `/auth/github/callback?code=c&state=${state}`,
    {
      headers: {
        Cookie: `${session}; ${cookieValue(start, '__Host-slide_oauth')}`,
      },
    },
  )
  expect(callback.status).toBe(403)
  const bindings = await platform.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM repository_bindings',
  ).first<{ count: number }>()
  expect(bindings?.count).toBe(0)
})

test('given no owner session, when decks are listed, then it is refused', async () => {
  expect((await listDecks('')).status).toBe(401)
})

const authRows = async () => {
  const rows = []
  for (const table of ['auth_user', 'auth_account', 'auth_session'])
    rows.push(
      (
        await platform.env.DB.prepare(
          `SELECT * FROM ${table} ORDER BY id`,
        ).all()
      ).results,
    )
  return rows
}

test.each([true, false])(
  'Given repository authorization with admin=%s, When it completes, Then auth identity and sessions are unchanged',
  async (admin) => {
    const session = await signIn()
    const before = await authRows()
    const { callback, requested } = await connect(
      session,
      form,
      repository(admin),
    )
    expect(callback.status).toBe(admin ? 302 : 403)
    expect(await authRows()).toEqual(before)
    expect(cookieValue(callback, '__Host-slide_owner')).toBeUndefined()
    expect(requested.at(-1)).toBe(
      'https://api.github.com/applications/Iv1.client/token',
    )
  },
)

test('Given a pending binding, When another login replaces its original session, Then the replacement cookie cannot complete the binding', async () => {
  const original = await signIn()
  const start = await request('/decks/connect', {
    method: 'POST',
    headers: {
      Cookie: original,
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form),
  })
  const state = new URL(start.headers.get('location')!).searchParams.get(
    'state',
  )
  const replacement = await signIn()
  const before = await authRows()
  stubGitHub(repository(true))
  const callback = await request(
    `/auth/github/callback?code=c&state=${state}`,
    {
      headers: {
        Cookie: `${replacement}; ${cookieValue(start, '__Host-slide_oauth')}`,
      },
    },
  )
  expect(callback.status).toBe(403)
  expect(await authRows()).toEqual(before)
  expect(await (await listDecks(replacement)).json()).toEqual({ decks: [] })
})

test('Given a binding started by the owner, When GitHub returns another account, Then no binding or auth state is changed', async () => {
  const session = await signIn()
  const start = await request('/decks/connect', {
    method: 'POST',
    headers: {
      Cookie: session,
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form),
  })
  const state = new URL(start.headers.get('location')!).searchParams.get(
    'state',
  )
  const before = await authRows()
  const requested = stubGitHub(repository(true), { id: 1, login: 'other' })
  const response = await request(
    `/auth/github/callback?code=c&state=${state}`,
    {
      headers: {
        Cookie: `${session}; ${cookieValue(start, '__Host-slide_oauth')}`,
      },
    },
  )
  expect(cookieValue(response, '__Host-slide_owner')).toBeUndefined()
  expect(await authRows()).toEqual(before)
  expect(await (await listDecks(session)).json()).toEqual({ decks: [] })
  expect(requested.at(-1)).toBe(
    'https://api.github.com/applications/Iv1.client/token',
  )
})
