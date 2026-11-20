import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decodeHTML } from 'entities'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { deployments, mcpGrants } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { dayFormats } from '../share/dates'
import {
  callMcp,
  callTool,
  connectAgent,
  mcpClient,
  requestToken,
} from './test-connect'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
let alice = ''
let bob = ''

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  bob = await signIn(env, 'bob', { id: INVITED_ID })
})
beforeEach(() => db.delete(mcpGrants))
afterAll(() => platform.dispose())

const settings = async (cookie = alice, lang = 'ja') => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/settings?lang=${lang}`, {
      headers: { Cookie: cookie },
    }),
    env,
  )
  return { status: response.status, page: await response.text() }
}
/** The part of the settings page about agents, tags removed. */
const agentsOf = (page: string) =>
  decodeHTML(
    (
      /<section class="panel" id="agents"[\s\S]*?<\/section>/.exec(page)?.[0] ??
      ''
    )
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  )
const revoke = (id: string, cookie = alice, origin = TEST_ORIGIN) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/settings/agents/${id}/revoke`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin },
      body: new URLSearchParams(),
    }),
    env,
  )
const grantOf = async (ownerId: string) =>
  (
    await db
      .select()
      .from(mcpGrants)
      .where(eq(mcpGrants.owner_user_id, ownerId))
  )[0]
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
const today = (lang: 'ja' | 'en') => dayFormats[lang].format(Date.now())

test('Given an author with no agent connected, When they open the settings, Then the frame shows the MCP URL to copy and says no agent is connected', async () => {
  const { status, page } = await settings()
  expect(status).toBe(200)
  expect(page).toContain(`id="mcp-url" readonly value="${TEST_ORIGIN}/mcp"`)
  expect(page).toContain('data-copy="mcp-url"')
  const frame = agentsOf(page)
  expect(frame).toContain('AI エージェントから置く')
  expect(frame).toContain('MCP サーバーの URL')
  expect(frame).toContain('公開するまで自分だけが見られます。')
  expect(frame).toContain('接続済みのエージェントはありません。')
})

test('F23-AC11: Given an agent the author connected, When they open the settings, Then it is listed by its name with the day it was connected, and, once used, the day it was last used', async () => {
  const { tokens } = await connectAgent(env, alice, '<i>Agent</i> & 友')
  const before = await settings()
  expect(before.page).not.toContain('<i>Agent</i>')
  expect(agentsOf(before.page)).toContain(
    `<i>Agent</i> & 友 接続した日: ${today('ja')} / まだ使っていません 接続を取り消す`,
  )
  expect(before.page).toContain(
    'aria-label="&lt;i&gt;Agent&lt;/i&gt; &amp; 友 の接続を取り消す"',
  )
  const client = await mcpClient(env, tokens.access_token)
  await callTool(client, 'list_slides')
  await client.close()
  const after = agentsOf((await settings()).page)
  expect(after).toContain(`最後に使った日: ${today('ja')}`)
  expect(after).not.toContain('まだ使っていません')
  const english = agentsOf((await settings(alice, 'en')).page)
  expect(english).toContain(
    `Connected: ${today('en')} / Last used: ${today('en')} Disconnect`,
  )
})

test('F23-AC11: Given a listed agent, When the author disconnects it, Then it leaves the list and the agent’s next request is an authorization error, with either of its tokens', async () => {
  const { tokens, clientId } = await connectAgent(env, alice, 'Leaving')
  const client = await mcpClient(env, tokens.access_token)
  expect((await callTool(client, 'list_slides')).isError).toBe(false)
  const grant = await grantOf(OWNER_ID)
  const response = await revoke(grant?.id ?? '')
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('/settings#agents')
  expect(agentsOf((await settings()).page)).not.toContain('Leaving')
  const next = await callMcp(env, bearer(tokens.access_token))
  expect(next.status).toBe(401)
  expect(next.headers.get('WWW-Authenticate')).toContain(
    'error="invalid_token"',
  )
  await expect(
    client.callTool({ name: 'list_slides', arguments: {} }),
  ).rejects.toThrow()
  const refreshed = await requestToken(env, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: clientId,
  })
  expect(refreshed.status).toBe(400)
  await client.close().catch(() => {})
})

test('F23-AC11: Given two authors with agents, When one opens the settings or disconnects by the other’s ID, Then they see only their own and the other’s stays connected', async () => {
  await connectAgent(env, alice, 'Alice’s agent')
  const bobs = await connectAgent(env, bob, 'Bob’s agent')
  const frame = agentsOf((await settings()).page)
  expect(frame).toContain('Alice’s agent')
  expect(frame).not.toContain('Bob’s agent')
  const bobGrant = await grantOf(INVITED_ID)
  expect((await revoke(bobGrant?.id ?? '')).status).toBe(303)
  expect(await grantOf(INVITED_ID)).toBeDefined()
  expect((await callMcp(env, bearer(bobs.tokens.access_token))).status).toBe(
    200,
  )
})

test('F23-AC11: Given an upload an agent began and has not finished, When the author disconnects the agent, Then the upload’s own credential no longer sends or finalizes, and an upload from the browser goes on', async () => {
  await seedDeck(database, 'talk', OWNER_ID)
  const fromBrowser = await seedDeployment(database, 'talk', 'uploading')
  const { tokens } = await connectAgent(env, alice, 'Uploader')
  const client = await mcpClient(env, tokens.access_token)
  const bytes = new TextEncoder().encode('<!doctype html><title>x</title>')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const { data: plan } = await callTool(client, 'begin_upload', {
    slide: 'talk',
    files: [
      {
        path: 'index.html',
        size: bytes.byteLength,
        sha256: Buffer.from(digest).toString('hex'),
      },
    ],
  })
  await client.close()
  const headers = plan.headers as { Authorization: string }
  const [file] = plan.files as { url: string }[]
  const grant = await grantOf(OWNER_ID)
  expect((await revoke(grant?.id ?? '')).status).toBe(303)
  const sent = await server.fetch(
    new Request(file?.url ?? '', { method: 'PUT', headers, body: bytes }),
    env,
  )
  expect(sent.status).toBe(409)
  expect(await sent.json()).toMatchObject({ code: 'session_expired' })
  const finalized = await server.fetch(
    new Request(
      `${TEST_ORIGIN}/api/uploads/${String(plan.uploadId)}/finalize`,
      {
        method: 'POST',
        headers,
      },
    ),
    env,
  )
  expect(finalized.status).toBe(409)
  const states = await db
    .select({ id: deployments.id, state: deployments.state })
    .from(deployments)
  expect(states).toEqual(
    expect.arrayContaining([
      { id: plan.uploadId, state: 'expired' },
      { id: fromBrowser, state: 'uploading' },
    ]),
  )
})

test('Given an ID that is not the author’s connection, When a disconnect is posted, Then no upload of theirs is given up', async () => {
  await seedDeck(database, 'other-talk', OWNER_ID)
  const id = await seedDeployment(database, 'other-talk', 'uploading')
  await db
    .update(deployments)
    .set({ source: 'mcp' })
    .where(eq(deployments.id, id))
  expect((await revoke('no-such-connection')).status).toBe(303)
  expect(
    (await db.select().from(deployments).where(eq(deployments.id, id)))[0]
      ?.state,
  ).toBe('uploading')
})

test.each([
  ['a form posted from another site', () => alice, 'https://evil.example', 403],
  ['nobody signed in', () => '', TEST_ORIGIN, 401],
])(
  'Given %s, When a disconnect is posted, Then it is refused and the agent stays connected',
  async (_, cookie, origin, status) => {
    await connectAgent(env, alice)
    const grant = await grantOf(OWNER_ID)
    expect((await revoke(grant?.id ?? '', cookie(), origin)).status).toBe(
      status,
    )
    expect(await grantOf(OWNER_ID)).toBeDefined()
  },
)

test('Given an ID no connection has, When a disconnect is posted, Then the author is sent back to the settings and nothing changes', async () => {
  await connectAgent(env, alice)
  expect((await revoke('no-such-connection')).status).toBe(303)
  expect(await grantOf(OWNER_ID)).toBeDefined()
})

test('Given a connection whose refresh token has run out, When the author opens the settings, Then it is not listed', async () => {
  await connectAgent(env, alice, 'Lapsed')
  await db
    .update(mcpGrants)
    .set({ refresh_expires_at: Math.floor(Date.now() / 1000) })
  expect(agentsOf((await settings()).page)).not.toContain('Lapsed')
})
