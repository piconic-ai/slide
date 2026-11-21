import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decodeHTML } from 'entities'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { accounts, mcpCodes, mcpGrants, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { hashToken } from './authorization'
import {
  answerConsent,
  authorizationFields,
  connectAgent,
  REDIRECT_URI,
  registerClient,
  requestToken,
  VERIFIER,
} from './test-connect'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
let alice = ''
let clientId = ''
let fields: Record<string, string> = {}

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  expect(alice).not.toBe('')
  clientId = await registerClient(env, '<b>Agent</b> & co')
  fields = await authorizationFields(clientId)
})
beforeEach(async () => {
  await db.batch([
    db.delete(mcpCodes),
    db.delete(mcpGrants),
    db.delete(suspensions),
  ])
})
afterAll(() => platform.dispose())

const authorize = (
  query: Record<string, string>,
  headers: Record<string, string> = { Cookie: alice },
) =>
  server.fetch(
    new Request(
      `${TEST_ORIGIN}/oauth/authorize?${new URLSearchParams(query)}`,
      { headers },
    ),
    env,
  )
const locationOf = (response: Response) =>
  new URL(response.headers.get('location') ?? '', TEST_ORIGIN)
const answerOf = (response: Response) =>
  Object.fromEntries(locationOf(response).searchParams)

test('Given a signed-in author, When an agent’s authorization request opens, Then the page names the agent and where the answer goes, and says in one sentence what is allowed', async () => {
  const response = await authorize(fields)
  expect(response.status).toBe(200)
  const page = await response.text()
  const shown = decodeHTML(page)
  expect(shown).toContain('<h1>エージェントとの接続を許可しますか</h1>')
  expect(shown).toMatch(
    /エージェントが名乗っている名前<br \/>\s*<strong><b>Agent<\/b> & co<\/strong>/,
  )
  expect(shown).toContain('slide は確かめていません')
  expect(page).not.toContain('<b>Agent</b>')
  expect(shown).toContain(
    'このエージェントは、あなたのスライドを置くことと、差し替えることができます。公開はできません。',
  )
  expect(shown).toMatch(
    /許可したあとの戻り先<br \/>\s*<strong>127\.0\.0\.1:3334<\/strong>/,
  )
  expect(shown).toContain('このコンピューターで動いているアプリ')
  expect(shown).toContain('GitHub の alice としてログイン中です。')
  expect(page).toContain('name="decision" value="allow"')
  expect(page).toContain('name="decision" value="deny"')
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(response.headers.get('Content-Security-Policy')).toContain(
    "form-action 'self' http://127.0.0.1:3334;",
  )
})

test('Given an English reader, When the authorization request opens, Then the page is in English', async () => {
  const page = decodeHTML(
    await (await authorize({ ...fields, lang: 'en' })).text(),
  )
  expect(page).toContain('<h1>Allow this agent to connect?</h1>')
  expect(page).toContain('<strong><b>Agent</b> & co</strong>')
  expect(page).toContain(
    'This agent can put up your slides and replace them. It cannot publish them.',
  )
})

test('Given a client that registered an https redirect, When its request opens, Then no warning about this computer is shown', async () => {
  const remote = 'https://agent.example/cb'
  const id = await registerClient(env, 'Remote', [remote])
  const page = decodeHTML(
    await (
      await authorize({
        ...(await authorizationFields(id)),
        redirect_uri: remote,
      })
    ).text(),
  )
  expect(page).toContain('<strong>agent.example</strong>')
  expect(page).not.toContain('このコンピューターで動いているアプリ')
})

test.each([
  ['an unknown client', { client_id: 'mcp_unknown' }, '登録されていません'],
  [
    'a very long client ID',
    { client_id: 'x'.repeat(101) },
    '登録されていません',
  ],
  [
    'a redirect URI that was not registered',
    { redirect_uri: 'https://evil.example/cb' },
    '登録されたものと違います',
  ],
])(
  'Given %s, When the request opens, Then the author is told and nobody is redirected',
  async (_, change, message) => {
    const response = await authorize({ ...fields, ...change })
    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.text()).toContain(message)
  },
)

test.each([
  [
    'a plain challenge',
    { code_challenge_method: 'plain' },
    '要求が正しくありません',
  ],
  [
    'the implicit grant',
    { response_type: 'token' },
    '接続の方式に合っていません',
  ],
  [
    'another resource',
    { resource: 'https://other.example/mcp' },
    'このサービスではない接続先',
  ],
])(
  'Given %s, When the request opens, Then the author is told on a page of the service and nobody is redirected, signed in or not',
  async (_, change, message) => {
    const visitors: Record<string, string>[] = [{ Cookie: alice }, {}]
    for (const headers of visitors) {
      const response = await authorize({ ...fields, ...change }, headers)
      expect(response.status).toBe(400)
      expect(response.headers.get('location')).toBeNull()
      expect(await response.text()).toContain(message)
    }
  },
)

test('Given a client anyone registered with a redirect URI of their own, When a link to a malformed request for it is opened, Then the service does not forward the reader to that site', async () => {
  const evil = 'https://evil.example/login'
  const id = await registerClient(env, 'x', [evil])
  const response = await authorize(
    { client_id: id, redirect_uri: evil, response_type: 'x' },
    {},
  )
  expect(response.status).toBe(400)
  expect(response.headers.get('location')).toBeNull()
})

test('Given a client over the per-IP budget, When it opens the authorization page, Then it is refused before the request is looked up', async () => {
  const limited = {
    ...env,
    AUTH_RATE_LIMITER: { limit: async () => ({ success: false }) },
  } as unknown as Env
  const response = await server.fetch(
    new Request(
      `${TEST_ORIGIN}/oauth/authorize?${new URLSearchParams(fields)}`,
      { headers: { Cookie: alice, 'CF-Connecting-IP': '203.0.113.7' } },
    ),
    limited,
  )
  expect(response.status).toBe(429)
  expect(response.headers.get('Retry-After')).not.toBeNull()
})

test('Given nobody signed in, When an authorization request opens, Then the request is kept in a cookie, sign-in starts, and landing back shows the same request', async () => {
  const response = await authorize(
    { ...fields, resource: `${TEST_ORIGIN}/mcp` },
    {},
  )
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('/auth/github?to=agent')
  const cookie = response.headers.getSetCookie().join('\n')
  expect(cookie).toMatch(/^__Host-slide_authorize=[^;]+;/)
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('Secure')
  expect(cookie).toContain('SameSite=Lax')
  expect(cookie).toContain('Path=/')
  const kept = cookie.split(';')[0] ?? ''
  const landed = await server.fetch(
    new Request(`${TEST_ORIGIN}/oauth/authorize`, {
      headers: { Cookie: `${alice}; ${kept}` },
    }),
    env,
  )
  expect(landed.status).toBe(303)
  expect(landed.headers.getSetCookie().join('\n')).toMatch(
    /__Host-slide_authorize=;.*Max-Age=0/,
  )
  const resumed = locationOf(landed)
  expect(resumed.pathname).toBe('/oauth/authorize')
  expect(Object.fromEntries(resumed.searchParams)).toEqual(fields)
})

test('Given a kept request whose cookie holds a line break and markup, When sign-in lands back, Then the redirect carries them encoded and the request is checked like any other', async () => {
  const kept = encodeURIComponent(
    'client_id=x\r\nSet-Cookie: a=b&next=<script>',
  )
  const landed = await server.fetch(
    new Request(`${TEST_ORIGIN}/oauth/authorize`, {
      headers: { Cookie: `${alice}; __Host-slide_authorize=${kept}` },
    }),
    env,
  )
  expect(landed.status).toBe(303)
  const location = landed.headers.get('location') ?? ''
  expect(location).toMatch(/^\/oauth\/authorize\?client_id=x%0D%0ASet-Cookie/)
  expect(location).not.toMatch(/[\r\n<>]/)
  const followed = await server.fetch(
    new Request(new URL(location, TEST_ORIGIN), { headers: { Cookie: alice } }),
    env,
  )
  expect(followed.status).toBe(400)
})

test('Given no request and no kept request, When the authorization page opens, Then the author is told to start again from the agent', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/oauth/authorize?lang=ja`, {
      headers: { Cookie: alice },
    }),
    env,
  )
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('接続の要求が見つかりません')
})

test('Given a suspended author, When an authorization request opens, Then the suspension is shown instead of the question', async () => {
  await db.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'phishing',
    suspended_at: 1,
    suspended_by: 'operator',
  })
  const response = await authorize(fields)
  expect(response.status).toBe(403)
  expect(await response.text()).not.toContain('name="decision"')
})

test('Given the author allows the agent, When the answer is posted, Then the client gets a one-time code, the state and the issuer, and only the code’s hash is stored', async () => {
  const response = await answerConsent(env, alice, fields)
  expect(response.status).toBe(303)
  const answer = answerOf(response)
  expect(locationOf(response).origin + locationOf(response).pathname).toBe(
    REDIRECT_URI,
  )
  expect(answer).toMatchObject({ state: 'st4te', iss: TEST_ORIGIN })
  expect(answer.code).toMatch(/^[A-Za-z0-9_-]{43}$/)
  const rows = await db.select().from(mcpCodes)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    code_hash: await hashToken(answer.code ?? ''),
    client_id: clientId,
    owner_user_id: OWNER_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: await hashToken(VERIFIER),
  })
  expect(JSON.stringify(rows)).not.toContain(answer.code)
})

test('Given the author does not allow the agent, When the answer is posted, Then the client is told access was denied and no code exists', async () => {
  const response = await answerConsent(env, alice, fields, 'deny')
  expect(response.status).toBe(303)
  expect(answerOf(response)).toEqual({
    error: 'access_denied',
    state: 'st4te',
    iss: TEST_ORIGIN,
  })
  expect(await db.select().from(mcpCodes)).toEqual([])
})

test('Given a form posted from another site with the author’s cookie, When it arrives, Then it is refused and no code exists', async () => {
  const response = await answerConsent(
    env,
    alice,
    fields,
    'allow',
    'https://evil.example',
  )
  expect(response.status).toBe(403)
  expect(await db.select().from(mcpCodes)).toEqual([])
})

test.each([
  [
    'a redirect URI swapped in the form',
    { redirect_uri: 'https://evil.example/cb' },
    400,
  ],
  ['a client swapped for an unknown one', { client_id: 'mcp_unknown' }, 400],
])(
  'Given %s, When the answer is posted, Then nothing the page carried is trusted: no code is made',
  async (_, change, status) => {
    const response = await answerConsent(env, alice, { ...fields, ...change })
    expect(response.status).toBe(status)
    expect(response.headers.get('location')).toBeNull()
    expect(await db.select().from(mcpCodes)).toEqual([])
  },
)

test('Given nobody signed in, When an answer is posted, Then sign-in is asked for and no code exists', async () => {
  const response = await answerConsent(env, '', fields)
  expect(response.status).toBe(401)
  expect(await db.select().from(mcpCodes)).toEqual([])
})

test('Given an author who has no handle yet, When they open or answer a request, Then they are told a handle is needed and no code exists', async () => {
  const bob = await signIn(env, 'bob', { id: INVITED_ID })
  await db.delete(accounts).where(eq(accounts.user_id, INVITED_ID))
  const opened = await authorize(fields, { Cookie: bob })
  expect(opened.status).toBe(400)
  expect(await opened.text()).toContain('ハンドルがまだ決まっていない')
  expect((await answerConsent(env, bob, fields)).status).toBe(400)
  expect(await db.select().from(mcpCodes)).toEqual([])
})

test('Given an author who deletes their account, When the account row goes, Then their codes and grants go with it', async () => {
  const carol = await signIn(env, 'bob', { id: INVITED_ID })
  await connectAgent(env, carol)
  await answerConsent(env, carol, fields)
  expect(await db.select().from(mcpGrants)).toHaveLength(1)
  expect(await db.select().from(mcpCodes)).toHaveLength(1)
  await db.delete(accounts).where(eq(accounts.user_id, INVITED_ID))
  expect(await db.select().from(mcpGrants)).toEqual([])
  expect(await db.select().from(mcpCodes)).toEqual([])
})

test('Given a signed-in author’s cookie alone, When the token endpoint is called without a code, Then the cookie gets nothing', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/oauth/token`, {
      method: 'POST',
      headers: {
        Cookie: alice,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_verifier: VERIFIER,
        code: 'guess',
      }),
    }),
    env,
  )
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: 'invalid_grant' })
  expect((await requestToken(env, {})).status).toBe(400)
})
