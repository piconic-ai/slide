import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { mcpClients, mcpCodes } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import {
  MAX_CLIENT_NAME_LENGTH,
  MAX_REDIRECT_URI_LENGTH,
  MAX_REGISTRATION_BYTES,
} from './client-registration'
import {
  IDLE_CLIENT_SECONDS,
  MAX_UNUSED_CLIENTS,
  readClient,
  UNUSED_CLIENT_SECONDS,
} from './oauth-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = testEnv(platform.env)

beforeAll(async () => {
  await applyMigrations(database)
  expect(await signIn(env)).not.toBe('')
})
beforeEach(() => db.delete(mcpClients))
afterAll(() => platform.dispose())

const get = (path: string, headers: Record<string, string> = {}) =>
  server.fetch(new Request(new URL(path, TEST_ORIGIN), { headers }), env)
const register = (body: unknown, headers: Record<string, string> = {}) =>
  server.fetch(
    new Request(new URL('/oauth/register', TEST_ORIGIN), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  )
const agent = {
  client_name: 'Test agent',
  redirect_uris: ['http://127.0.0.1:3334/callback'],
}

test.each([
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-protected-resource',
])(
  'Given the MCP server, When %s is read, Then it names the server and the service as its authorization server',
  async (path) => {
    const response = await get(path)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      resource: `${TEST_ORIGIN}/mcp`,
      authorization_servers: [TEST_ORIGIN],
      bearer_methods_supported: ['header'],
      scopes_supported: ['slides:upload'],
    })
  },
)

test('Given a request that names another host, When the authorization server metadata is read, Then every endpoint is under the configured origin and only PKCE with S256 is offered', async () => {
  const response = await get('/.well-known/oauth-authorization-server', {
    Host: 'evil.example',
    'X-Forwarded-Host': 'evil.example',
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    issuer: TEST_ORIGIN,
    authorization_endpoint: `${TEST_ORIGIN}/oauth/authorize`,
    token_endpoint: `${TEST_ORIGIN}/oauth/token`,
    registration_endpoint: `${TEST_ORIGIN}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['slides:upload'],
    authorization_response_iss_parameter_supported: true,
  })
})

test('Given an agent, When it registers itself, Then it gets a public client ID and the client is stored without a secret', async () => {
  const response = await register(agent)
  expect(response.status).toBe(201)
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  const body = (await response.json()) as Record<string, unknown>
  expect(body).toMatchObject({
    client_name: 'Test agent',
    redirect_uris: agent.redirect_uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  })
  expect(body).not.toHaveProperty('client_secret')
  expect(await readClient(database, String(body.client_id))).toEqual({
    id: body.client_id,
    name: 'Test agent',
    redirectUris: agent.redirect_uris,
  })
})

test('Given two registrations of the same agent, When both succeed, Then each gets its own client ID', async () => {
  const ids = await Promise.all(
    [agent, agent].map(async (body) => {
      const response = await register(body)
      return ((await response.json()) as { client_id: string }).client_id
    }),
  )
  expect(new Set(ids).size).toBe(2)
})

test.each([
  ['a body that is not JSON', '{', 'invalid_redirect_uri'],
  ['an empty body', '', 'invalid_redirect_uri'],
  [
    'a redirect to plain http',
    { redirect_uris: ['http://agent.example/cb'] },
    'invalid_redirect_uri',
  ],
  [
    'an invisible name',
    { ...agent, client_name: '​' },
    'invalid_client_metadata',
  ],
  [
    'a body over the size limit',
    { ...agent, padding: 'x'.repeat(MAX_REGISTRATION_BYTES) },
    'invalid_redirect_uri',
  ],
])(
  'Given %s, When an agent registers, Then it is refused as RFC 7591 says and nothing is stored',
  async (_, body, error) => {
    const response = await register(body)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error })
    expect(await db.select().from(mcpClients)).toEqual([])
  },
)

const row = (
  id: string,
  created_at: number,
  used_at: number | null = null,
) => ({
  id,
  name: id,
  redirect_uris: '["https://agent.example/cb"]',
  created_at,
  used_at,
})
const clientIds = async () =>
  (await db.select({ id: mcpClients.id }).from(mcpClients))
    .map(({ id }) => id)
    .filter((id) => !id.startsWith('mcp_'))
    .sort()

test('Given clients nobody connected through, When another agent registers, Then those older than the hour are removed, and one with a pending code or registered just now is kept', async () => {
  const now = Math.floor(Date.now() / 1000)
  const old = now - UNUSED_CLIENT_SECONDS - 60
  await db
    .insert(mcpClients)
    .values([row('unused', old), row('pending', old), row('recent', now - 60)])
  await db.insert(mcpCodes).values({
    code_hash: 'h',
    client_id: 'pending',
    owner_user_id: OWNER_ID,
    redirect_uri: 'https://agent.example/cb',
    code_challenge: 'c',
    expires_at: old,
  })
  expect((await register(agent)).status).toBe(201)
  expect(await clientIds()).toEqual(['pending', 'recent'])
})

test('Given clients an author once connected through and no longer does, When another agent registers, Then one used within ninety days is kept, so its agent can come back with the same client ID, and one idle longer is removed', async () => {
  const now = Math.floor(Date.now() / 1000)
  const longAgo = now - IDLE_CLIENT_SECONDS - 60
  await db
    .insert(mcpClients)
    .values([
      row('revoked-yesterday', longAgo, now - 24 * 60 * 60),
      row('idle-too-long', longAgo, longAgo),
    ])
  expect((await register(agent)).status).toBe(201)
  expect(await clientIds()).toEqual(['revoked-yesterday'])
})

test('Given as many unused clients as are kept at once, When one more agent registers, Then it is told to retry later and no row is added; a client in use does not count', async () => {
  const now = Math.floor(Date.now() / 1000)
  const waiting = Array.from({ length: MAX_UNUSED_CLIENTS }, (_, index) =>
    row(`waiting-${index}`, now),
  )
  for (let start = 0; start < waiting.length; start += 20)
    await db.insert(mcpClients).values(waiting.slice(start, start + 20))
  const refused = await register(agent)
  expect(refused.status).toBe(503)
  expect(refused.headers.get('Retry-After')).not.toBeNull()
  expect(await refused.json()).toMatchObject({
    error: 'temporarily_unavailable',
  })
  expect(await db.$count(mcpClients)).toBe(MAX_UNUSED_CLIENTS)
  await db
    .update(mcpClients)
    .set({ used_at: now })
    .where(eq(mcpClients.id, 'waiting-0'))
  expect((await register(agent)).status).toBe(201)
})

test('Given the cleanup a registration runs, When SQLite plans it, Then it searches the index on used_at and created_at instead of scanning every client', async () => {
  const plan = await db.all<{ detail: string }>(
    sql`EXPLAIN QUERY PLAN DELETE FROM mcp_clients WHERE used_at IS NULL AND created_at < 5`,
  )
  expect(plan.map(({ detail }) => detail).join(' ')).toMatch(
    /SEARCH mcp_clients USING (COVERING )?INDEX mcp_clients_used/,
  )
})

test.each([
  [
    'a redirect URI longer than the limit',
    {
      redirect_uris: [
        `https://a.example/${'a'.repeat(MAX_REDIRECT_URI_LENGTH)}`,
      ],
    },
  ],
  [
    'a name longer than the limit',
    { ...agent, client_name: 'n'.repeat(MAX_CLIENT_NAME_LENGTH + 1) },
  ],
])(
  'Given %s, When an agent registers, Then it is refused, so one row stays small',
  async (_, body) => {
    expect((await register(body)).status).toBe(400)
    expect(await db.$count(mcpClients)).toBe(0)
  },
)

test('Given a page of another site, When it calls the registration endpoint, Then no CORS header lets it read the answer', async () => {
  const response = await register(agent, {
    Origin: 'https://elsewhere.example',
  })
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
})

test('Given a stored client whose redirect URIs are damaged, When it is read, Then reading fails instead of trusting the row', async () => {
  await db.insert(mcpClients).values({
    id: 'damaged',
    name: 'x',
    redirect_uris: '{"not":"a list"}',
    created_at: 1,
  })
  await expect(readClient(database, 'damaged')).rejects.toThrow()
  expect(await readClient(database, 'missing')).toBeNull()
})
