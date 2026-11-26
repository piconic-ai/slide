import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { mcpCodes, mcpGrants } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import server from '../app/routes'
import {
  OWNER_ID,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { hashToken } from './authorization'
import { insertCode } from './oauth-store'
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

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
})
beforeEach(() => db.batch([db.delete(mcpCodes), db.delete(mcpGrants)]))
afterAll(() => platform.dispose())

const storedScopes = async () =>
  (await db.select({ scope: mcpGrants.scope }).from(mcpGrants)).map(
    (row) => row.scope,
  )

test('F23-AC46: Given an author who allows an agent, When it exchanges the code, Then the code, the grant and the token answer carry both scopes the screen listed', async () => {
  const clientId = await registerClient(env)
  const allowed = await answerConsent(
    env,
    alice,
    await authorizationFields(clientId),
  )
  const code =
    new URL(allowed.headers.get('location') ?? '').searchParams.get('code') ??
    ''
  expect(
    (await db.select({ scope: mcpCodes.scope }).from(mcpCodes)).map(
      (row) => row.scope,
    ),
  ).toEqual(['slides:upload slides:export'])
  const response = await requestToken(env, {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  })
  expect(((await response.json()) as Tokens).scope).toBe(
    'slides:upload slides:export',
  )
  expect(await storedScopes()).toEqual(['slides:upload slides:export'])
})

test('F23-AC46: Given an authorization request that names only the upload scope, When the author allows it, Then the grant still holds what the screen listed', async () => {
  const clientId = await registerClient(env)
  const allowed = await answerConsent(
    env,
    alice,
    await authorizationFields(clientId, { scope: 'slides:upload' }),
  )
  const code =
    new URL(allowed.headers.get('location') ?? '').searchParams.get('code') ??
    ''
  await requestToken(env, {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  })
  expect(await storedScopes()).toEqual(['slides:upload slides:export'])
})

test('F23-AC47: Given a code allowed before the export scope existed, When it is exchanged afterwards, Then the grant holds the upload scope only', async () => {
  const clientId = await registerClient(env)
  // A row of the older version: its code was written without a scope.
  await db.insert(mcpCodes).values({
    code_hash: await hashToken('old-code'),
    client_id: clientId,
    owner_user_id: OWNER_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: await hashToken(VERIFIER),
    expires_at: Math.floor(Date.now() / 1000) + 60,
  })
  const response = await requestToken(env, {
    grant_type: 'authorization_code',
    code: 'old-code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  })
  expect(((await response.json()) as Tokens).scope).toBe('slides:upload')
  expect(await storedScopes()).toEqual(['slides:upload'])
})

test('F23-AC47, F23-AC48: Given a connection made before the export scope, When its refresh token is used, Then the new tokens keep the upload scope only, and connecting again gives both', async () => {
  const { clientId, tokens } = await connectAgent(env, alice, 'Old agent')
  // The connection as an older version made it.
  await db.update(mcpGrants).set({ scope: 'slides:upload' })
  const refreshed = await requestToken(env, {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: clientId,
  })
  expect(refreshed.status).toBe(200)
  expect(((await refreshed.json()) as Tokens).scope).toBe('slides:upload')
  expect(await storedScopes()).toEqual(['slides:upload'])

  // The author allows the same agent again: the grant is replaced by one
  // that holds both.
  const allowed = await answerConsent(
    env,
    alice,
    await authorizationFields(clientId),
  )
  const code =
    new URL(allowed.headers.get('location') ?? '').searchParams.get('code') ??
    ''
  await requestToken(env, {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  })
  expect(await storedScopes()).toEqual(['slides:upload slides:export'])
})

test('F23-AC46: Given a code written by a later version with a word this one does not know, When it is exchanged, Then only the known words are granted', async () => {
  const clientId = await registerClient(env)
  await insertCode(database, {
    codeHash: await hashToken('future-code'),
    clientId,
    ownerUserId: OWNER_ID,
    redirectUri: REDIRECT_URI,
    codeChallenge: await hashToken(VERIFIER),
    scopes: ['slides:upload'],
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  })
  await db.update(mcpCodes).set({ scope: 'slides:upload slides:admin' })
  const response = await requestToken(env, {
    grant_type: 'authorization_code',
    code: 'future-code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_verifier: VERIFIER,
  })
  expect(((await response.json()) as Tokens).scope).toBe('slides:upload')
})

test('F23-AC46: Given the consent page, When it is opened, Then its form carries the permissions it lists', async () => {
  const clientId = await registerClient(env)
  const url = new URLSearchParams(await authorizationFields(clientId))
  const page = await (
    await server.fetch(
      new Request(`${TEST_ORIGIN}/oauth/authorize?${url}`, {
        headers: { Cookie: alice },
      }),
      env,
    )
  ).text()
  expect(page).toContain(
    'name="shown_scope" value="slides:upload slides:export"',
  )
})

test.each([
  ['an older page that listed only putting up', 'slides:upload'],
  ['an older form that carried nothing', ''],
  ['a list with a word the page never had', 'slides:upload slides:export x'],
])(
  'F23-AC46: Given %s answered with Allow, When the answer arrives, Then nothing is granted and the page is shown again; Don’t allow still answers',
  async (_, shown) => {
    const clientId = await registerClient(env)
    const fields = await authorizationFields(clientId)
    const stale = await answerConsent(env, alice, {
      ...fields,
      shown_scope: shown,
    })
    expect(stale.status).toBe(200)
    expect(stale.headers.get('location')).toBeNull()
    const page = await stale.text()
    expect(page).toContain('slides:upload slides:export')
    expect(page).toContain('name="decision" value="allow"')
    expect(await db.select().from(mcpCodes)).toEqual([])
    expect(await db.select().from(mcpGrants)).toEqual([])
    const denied = await answerConsent(
      env,
      alice,
      { ...fields, shown_scope: shown },
      'deny',
    )
    expect(denied.status).toBe(303)
    expect(
      new URL(denied.headers.get('location') ?? '').searchParams.get('error'),
    ).toBe('access_denied')
  },
)
