import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { decks, deployments, mcpGrants, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  seedDeck,
  seedDeployment,
  seedPublic,
  keepInvited,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import server from '../app/routes'
import { LAST_USED_STEP_SECONDS } from './access-store'
import { MAX_MESSAGE_BYTES } from './server-routes'
import {
  callMcp,
  callTool,
  connectAgent,
  ERAS,
  mcpClient,
  type Tokens,
} from './test-connect'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
let alice = ''
let tokens: Tokens
let bobTokens: Tokens

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  const bob = await signIn(env, 'bob', { id: INVITED_ID })
  tokens = (await connectAgent(env, alice)).tokens
  bobTokens = (await connectAgent(env, bob)).tokens
  await seedPublic(database, 'keynote', 200, 'Alice’s <keynote>', OWNER_ID)
  await seedDeck(database, 'draft', OWNER_ID)
  await seedPublic(database, 'bobs', 100, 'Bob’s talk', INVITED_ID, 'secret')
})
beforeEach(() => db.delete(suspensions))
afterAll(() => platform.dispose())

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
const now = () => Math.floor(Date.now() / 1000)

describe('who may call /mcp', () => {
  test('F23-AC1: Given a client with no token, When it calls /mcp, Then it gets 401 naming the protected resource metadata and the scope, and no tool answers', async () => {
    const response = await callMcp(env, {})
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe(
      `Bearer resource_metadata="${TEST_ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="slides:upload slides:export"`,
    )
    expect(await response.text()).not.toContain('list_slides')
  })

  test.each([
    ['a token that was never issued', () => 'slide_at_never'],
    [
      'the refresh token in place of the access token',
      () => tokens.refresh_token,
    ],
    ['a token with characters no token has', () => 'a b'],
  ])(
    'F23-AC1: Given %s, When it calls /mcp, Then it gets 401 saying the token is invalid',
    async (_, token) => {
      const response = await callMcp(env, bearer(token()))
      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toContain(
        'resource_metadata=',
      )
    },
  )

  test('F23-AC1: Given the author’s session cookie and no token, When /mcp is called, Then the cookie is not read: 401', async () => {
    const response = await callMcp(env, { Cookie: alice })
    expect(response.status).toBe(401)
  })

  test('F23-AC1: Given an access token past its hour, When it calls /mcp, Then it gets 401 with an invalid_token challenge', async () => {
    const { tokens: short } = await connectAgent(env, alice, 'Short-lived')
    await db
      .update(mcpGrants)
      .set({ access_expires_at: now() })
      .where(eq(mcpGrants.owner_user_id, OWNER_ID))
    const response = await callMcp(env, bearer(short.access_token))
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toContain(
      'error="invalid_token"',
    )
    tokens = (await connectAgent(env, alice)).tokens
  })

  test.each([
    ['a page of another site', 'https://evil.example', 403],
    ['a sandboxed frame', 'null', 403],
    ['the service’s own origin', TEST_ORIGIN, 200],
    ['an app with its own scheme', 'vscode-file://vscode-app', 200],
  ])(
    'Given a valid token sent from %s, When /mcp is called, Then the answer is %s %i',
    async (_, origin, status) => {
      const response = await callMcp(env, {
        ...bearer(tokens.access_token),
        Origin: origin,
      })
      expect(response.status).toBe(status)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    },
  )

  test.each(['GET', 'DELETE', 'PUT'])(
    'Given a valid token, When /mcp is asked with %s, Then it answers 405 and allows POST only',
    async (method) => {
      const response = await callMcp(
        env,
        bearer(tokens.access_token),
        undefined,
        method,
      )
      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toBe('POST')
    },
  )

  test('Given a grant, When its token is used, Then the day it was last used is written, and not rewritten within the hour', async () => {
    const read = async () =>
      (
        await db
          .select({ at: mcpGrants.last_used_at })
          .from(mcpGrants)
          .where(eq(mcpGrants.owner_user_id, INVITED_ID))
      )[0]?.at
    expect(await read()).toBeNull()
    await callMcp(env, bearer(bobTokens.access_token))
    expect(await read()).toBeGreaterThan(now() - 60)
    const recent = now() - LAST_USED_STEP_SECONDS + 60
    await db
      .update(mcpGrants)
      .set({ last_used_at: recent })
      .where(eq(mcpGrants.owner_user_id, INVITED_ID))
    await callMcp(env, bearer(bobTokens.access_token))
    expect(await read()).toBe(recent)
    await db
      .update(mcpGrants)
      .set({ last_used_at: recent - 120 })
      .where(eq(mcpGrants.owner_user_id, INVITED_ID))
    await callMcp(env, bearer(bobTokens.access_token))
    expect(await read()).toBeGreaterThan(recent)
  })
})

describe('what one request may carry', () => {
  const call = (id: number) => ({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'list_slides', arguments: {} },
  })

  test('Given a valid token, When a request carries an array of two tool calls, Then it is refused with 400 and no tool runs', async () => {
    const response = await callMcp(env, bearer(tokens.access_token), [
      call(1),
      call(2),
    ])
    expect(response.status).toBe(400)
    const body = await response.text()
    expect(body).toContain('Batches are not accepted')
    expect(body).not.toContain('keynote')
  })

  test('Given a valid token, When one tool call is posted on its own, Then it is answered', async () => {
    const response = await callMcp(env, bearer(tokens.access_token), call(1))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('keynote')
  })

  test.each([
    ['a body that is not JSON', '{"jsonrpc":', 400],
    ['a body over the size read', `"${'x'.repeat(MAX_MESSAGE_BYTES)}"`, 413],
  ])(
    'Given a valid token, When it posts %s, Then it is refused with %i',
    async (_, body, status) => {
      const response = await server.fetch(
        new Request(`${TEST_ORIGIN}/mcp`, {
          method: 'POST',
          headers: {
            ...bearer(tokens.access_token),
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body,
        }),
        env,
      )
      expect(response.status).toBe(status)
    },
  )
})

describe.each(ERAS)('a client of the %j era', (era) => {
  test('F23-AC2: Given the author allowed the agent in the browser, When the official client connects with its token, Then it can list the tools', async () => {
    const client = await mcpClient(env, tokens.access_token, era)
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['list_slides', 'get_status']),
    )
    await client.close()
  })

  test('F23-AC3: Given the tool list, When its names and descriptions are read, Then no tool publishes, unpublishes or deletes', async () => {
    const client = await mcpClient(env, tokens.access_token, era)
    const { tools } = await client.listTools()
    for (const tool of tools)
      expect(tool.name).not.toMatch(
        /publish|unpublish|pause|delete|rename|setting/i,
      )
    expect(client.getInstructions()).toContain(
      'cannot publish, unpublish or delete',
    )
    await client.close()
  })

  test('Given an author with a public slide and a draft, When list_slides is called, Then only their own slides come back, with manage and share URLs', async () => {
    const client = await mcpClient(env, tokens.access_token, era)
    const { isError, data } = await callTool(client, 'list_slides')
    expect(isError).toBe(false)
    expect(data.slides).toEqual([
      {
        slide: 'keynote',
        title: 'Alice’s <keynote>',
        visibility: 'public',
        manageUrl: `${TEST_ORIGIN}/my/slides/keynote`,
        shareUrl: `${TEST_ORIGIN}/@alice/keynote`,
        updatedAt: new Date(200_000).toISOString(),
      },
      {
        slide: 'draft',
        title: 'draft',
        visibility: 'private',
        manageUrl: `${TEST_ORIGIN}/my/slides/draft`,
        shareUrl: null,
        updatedAt: new Date(1000).toISOString(),
      },
    ])
    await client.close()
  })
})

describe('get_status', () => {
  test('Given a public slide with a newer version still being received, When get_status is called, Then it says the slide is public and the newest upload is not the public version', async () => {
    const receiving = await seedDeployment(database, 'keynote', 'uploading')
    await db
      .update(deployments)
      .set({ created_at: 300 })
      .where(eq(deployments.id, receiving))
    const client = await mcpClient(env, tokens.access_token)
    const { data } = await callTool(client, 'get_status', { slide: 'keynote' })
    expect(data).toMatchObject({
      slide: 'keynote',
      visibility: 'public',
      shareUrl: `${TEST_ORIGIN}/@alice/keynote`,
      newestUpload: {
        uploadId: receiving,
        state: 'uploading',
        readyAt: null,
        isPublicVersion: false,
      },
    })
    await client.close()
  })

  test('Given a slide nothing was ever sent to, When get_status is called, Then it has no newest upload', async () => {
    const client = await mcpClient(env, tokens.access_token)
    const { data } = await callTool(client, 'get_status', { slide: 'draft' })
    expect(data).toMatchObject({ visibility: 'private', newestUpload: null })
    await client.close()
  })

  test.each([
    ['another author’s slide', 'secret'],
    ['a slide that does not exist', 'nothing-here'],
    ['a name no slide can have', '../keynote'],
    ['an empty name', ''],
  ])(
    'F23-AC8: Given %s, When get_status names it, Then the answer is the same refusal, which does not say whether it exists',
    async (_, slide) => {
      const client = await mcpClient(env, tokens.access_token)
      const { isError, data } = await callTool(client, 'get_status', { slide })
      expect(isError).toBe(true)
      expect(data).toEqual({
        error: 'unknown_slide',
        message:
          'The author has no slide with that URL name. Call list_slides to see the names.',
      })
      await client.close()
    },
  )

  test('Given an author whose slide is being deleted, When get_status names it, Then it is unknown', async () => {
    await seedDeck(database, 'going', OWNER_ID)
    await db.update(decks).set({ deleted_at: 5 }).where(eq(decks.id, 'going'))
    const client = await mcpClient(env, tokens.access_token)
    const { data } = await callTool(client, 'get_status', { slide: 'going' })
    expect(data.error).toBe('unknown_slide')
    await client.close()
  })
})

describe('an owner who may no longer act', () => {
  test.each(['list_slides', 'get_status'])(
    'F23-AC10: Given an author removed from the registered authors after connecting, When their agent calls %s, Then it is refused with the reason',
    async (tool) => {
      await keepInvited(env.DB, [OWNER_ID])
      const removed = env
      const client = await mcpClient(removed, bobTokens.access_token)
      const { isError, data } = await callTool(client, tool, {
        slide: 'secret',
      })
      expect(isError).toBe(true)
      expect(data.error).toBe('not_allowed')
      expect(data.message).toContain('not registered as an author')
      await client.close()
    },
  )

  test('F23-AC10: Given an author suspended after connecting, When their agent calls a tool, Then it is refused with the reason', async () => {
    await db.insert(suspensions).values({
      user_id: OWNER_ID,
      reason: 'phishing',
      suspended_at: 1,
      suspended_by: 'operator',
    })
    const client = await mcpClient(env, tokens.access_token)
    const { isError, data } = await callTool(client, 'list_slides')
    expect(isError).toBe(true)
    expect(data.error).toBe('not_allowed')
    await client.close()
  })
})
