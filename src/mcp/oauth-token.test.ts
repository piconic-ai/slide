import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { mcpCodes, mcpGrants } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import {
  ACCESS_TOKEN_SECONDS,
  hashToken,
  REFRESH_TOKEN_SECONDS,
} from './authorization'
import {
  answerConsent,
  authorizationFields,
  connectAgent,
  REDIRECT_URI,
  registerClient,
  requestToken,
  VERIFIER,
  type Tokens,
} from './test-connect'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = testEnv(platform.env)
let alice = ''
let clientId = ''

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  clientId = await registerClient(env)
})
beforeEach(() => db.batch([db.delete(mcpCodes), db.delete(mcpGrants)]))
afterAll(() => platform.dispose())

/** A fresh code the author just allowed for the test client. */
async function allowedCode(extra: Record<string, string> = {}) {
  const response = await answerConsent(
    env,
    alice,
    await authorizationFields(clientId, extra),
  )
  return (
    new URL(response.headers.get('location') ?? '').searchParams.get('code') ??
    ''
  )
}
const exchange = (code: string, change: Record<string, string> = {}) =>
  requestToken(env, {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
    ...change,
  })
const refresh = (token: string, client = clientId) =>
  requestToken(env, {
    grant_type: 'refresh_token',
    refresh_token: token,
    client_id: client,
  })
const now = () => Math.floor(Date.now() / 1000)

test('Given a code the author allowed, When the client exchanges it with its verifier, Then it gets a bearer token and a refresh token, and the database holds only their hashes', async () => {
  const response = await exchange(await allowedCode(), {
    resource: `${TEST_ORIGIN}/mcp`,
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  const tokens = (await response.json()) as Tokens
  expect(tokens).toMatchObject({
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_SECONDS,
    scope: 'slides:upload',
  })
  expect(tokens.access_token).toMatch(/^slide_at_[A-Za-z0-9_-]{43}$/)
  expect(tokens.refresh_token).toMatch(/^slide_rt_[A-Za-z0-9_-]{43}$/)
  const rows = await db.select().from(mcpGrants)
  expect(rows).toHaveLength(1)
  const [grant] = rows
  expect(grant).toMatchObject({
    client_id: clientId,
    owner_user_id: OWNER_ID,
    access_token_hash: await hashToken(tokens.access_token),
    refresh_token_hash: await hashToken(tokens.refresh_token),
    previous_refresh_token_hash: null,
    last_used_at: null,
  })
  expect(grant?.access_expires_at).toBeGreaterThan(now())
  expect(grant?.refresh_expires_at).toBeGreaterThan(
    now() + REFRESH_TOKEN_SECONDS - 60,
  )
  // No column of any table holds a token as the client was given it.
  const stored = JSON.stringify([rows, await db.select().from(mcpCodes)])
  expect(stored).not.toContain(tokens.access_token)
  expect(stored).not.toContain(tokens.refresh_token)
  expect(stored).not.toContain(tokens.access_token.slice('slide_at_'.length))
  expect(stored).not.toContain(tokens.refresh_token.slice('slide_rt_'.length))
})

test('Given a code already exchanged, When it is sent again, Then it is refused', async () => {
  const code = await allowedCode()
  expect((await exchange(code)).status).toBe(200)
  const again = await exchange(code)
  expect(again.status).toBe(400)
  expect(await again.json()).toEqual({ error: 'invalid_grant' })
  expect(await db.select().from(mcpGrants)).toHaveLength(1)
})

test('Given one code sent twice at once, When both requests race, Then exactly one gets tokens', async () => {
  const code = await allowedCode()
  const statuses = (await Promise.all([exchange(code), exchange(code)])).map(
    ({ status }) => status,
  )
  expect(statuses.sort()).toEqual([200, 400])
})

test.each([
  ['the wrong verifier', { code_verifier: 'w'.repeat(43) }],
  ['another redirect URI', { redirect_uri: 'http://127.0.0.1:3334/other' }],
  ['another client', { client_id: 'mcp_other' }],
])(
  'Given a code sent with %s, When it is exchanged, Then it is refused and the code is spent',
  async (_, change) => {
    const code = await allowedCode()
    const refused = await exchange(code, change)
    expect(refused.status).toBe(400)
    expect(await refused.json()).toEqual({ error: 'invalid_grant' })
    expect((await exchange(code)).status).toBe(400)
    expect(await db.select().from(mcpGrants)).toEqual([])
  },
)

test('Given a code past its minute, When it is exchanged, Then it is refused', async () => {
  const code = await allowedCode()
  await db.update(mcpCodes).set({ expires_at: now() })
  expect((await exchange(code)).status).toBe(400)
  expect(await db.select().from(mcpGrants)).toEqual([])
})

test.each([
  ['a code that was never issued', { code: 'never' }, 'invalid_grant'],
  [
    'another resource',
    { resource: 'https://other.example/mcp' },
    'invalid_target',
  ],
  [
    'client credentials',
    { grant_type: 'client_credentials' },
    'unsupported_grant_type',
  ],
  ['no verifier', { code_verifier: '' }, 'invalid_request'],
])(
  'Given %s, When the token endpoint is asked, Then it answers %s',
  async (_, change, error) => {
    const response = await exchange('unused', change)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error })
  },
)

test.each([
  [
    'JSON instead of a form',
    'application/json',
    '{"grant_type":"refresh_token"}',
  ],
  [
    'a form far too large',
    'application/x-www-form-urlencoded',
    `grant_type=${'x'.repeat(20000)}`,
  ],
])(
  'Given %s, When it is posted to the token endpoint, Then it is an invalid request',
  async (_, type, body) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': type },
        body,
      }),
      env,
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
  },
)

test('Given a refresh token, When the client uses it, Then both tokens are replaced and the old ones stop matching', async () => {
  const { tokens, clientId: agent } = await connectAgent(env, alice)
  const [before] = await db.select().from(mcpGrants)
  const response = await refresh(tokens.refresh_token, agent)
  expect(response.status).toBe(200)
  const next = (await response.json()) as Tokens
  expect(next.access_token).not.toBe(tokens.access_token)
  expect(next.refresh_token).not.toBe(tokens.refresh_token)
  const rows = await db.select().from(mcpGrants)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    id: before?.id,
    created_at: before?.created_at,
    access_token_hash: await hashToken(next.access_token),
    refresh_token_hash: await hashToken(next.refresh_token),
    previous_refresh_token_hash: await hashToken(tokens.refresh_token),
  })
})

test('Given a refresh token already replaced, When it is used again, Then the whole grant ends, for it was copied', async () => {
  const { tokens, clientId: agent } = await connectAgent(env, alice)
  const next = (await (
    await refresh(tokens.refresh_token, agent)
  ).json()) as Tokens
  expect(next.refresh_token).toMatch(/^slide_rt_/)
  const reused = await refresh(tokens.refresh_token, agent)
  expect(reused.status).toBe(400)
  expect(await reused.json()).toEqual({ error: 'invalid_grant' })
  expect(await db.select().from(mcpGrants)).toEqual([])
  expect((await refresh(next.refresh_token, agent)).status).toBe(400)
})

test.each([
  [
    'an access token in place of the refresh token',
    (t: Tokens) => refresh(t.access_token),
  ],
  ['another client’s ID', (t: Tokens) => refresh(t.refresh_token, 'mcp_other')],
  ['a token that was never issued', () => refresh('slide_rt_never')],
])(
  'Given %s, When a refresh is asked, Then it is refused and the grant is kept',
  async (_, ask) => {
    const { tokens } = await connectAgent(env, alice)
    const response = await ask(tokens)
    expect(response.status).toBe(400)
    expect(await db.select().from(mcpGrants)).toHaveLength(1)
  },
)

test('Given a grant whose refresh token is past its time, When it is refreshed, Then it is refused, and the next grant made clears it away', async () => {
  const { tokens, clientId: agent } = await connectAgent(env, alice)
  await db.update(mcpGrants).set({ refresh_expires_at: now() })
  expect((await refresh(tokens.refresh_token, agent)).status).toBe(400)
  const other = await registerClient(env, 'Other')
  const allowed = await answerConsent(
    env,
    alice,
    await authorizationFields(other),
  )
  const code =
    new URL(allowed.headers.get('location') ?? '').searchParams.get('code') ??
    ''
  expect((await exchange(code, { client_id: other })).status).toBe(200)
  const rows = await db.select().from(mcpGrants)
  expect(rows.map((row) => row.client_id)).toEqual([other])
})

test('Given an author who connects the same agent again, When the second code is exchanged, Then the first grant is replaced, not kept beside it', async () => {
  const first = (await (await exchange(await allowedCode())).json()) as Tokens
  const second = (await (await exchange(await allowedCode())).json()) as Tokens
  const rows = await db
    .select()
    .from(mcpGrants)
    .where(eq(mcpGrants.client_id, clientId))
  expect(rows).toHaveLength(1)
  expect(rows[0]?.access_token_hash).toBe(await hashToken(second.access_token))
  expect((await refresh(first.refresh_token)).status).toBe(400)
})
