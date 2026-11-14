import { eq } from 'drizzle-orm'
import { vi } from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import {
  authAccount,
  authSession,
  authUser,
  authVerification,
} from '../db/auth-schema'
import {
  accounts,
  citations,
  contentSessions,
  decks,
  deployments,
  previewLaunches,
  repositoryBindings,
  uploadFiles,
} from '../db/schema'
import server from '../../server'

export const TEST_ORIGIN = 'https://slide.example'
export const OWNER_ID = '722500'

/** Test configuration for the management origin with owner login enabled. */
export function testEnv(platformEnv: Env): Env {
  return {
    ...platformEnv,
    GITHUB_APP_CLIENT_ID: 'Iv1.client',
    GITHUB_APP_CLIENT_SECRET: 'secret',
    BETTER_AUTH_SECRET: 'test-only-better-auth-secret-32-bytes-long',
    PUBLIC_ORIGIN: TEST_ORIGIN,
  } as unknown as Env
}

/** Signs in as the allowed owner with GitHub stubbed; returns the cookie. */
export async function signIn(env: Env, login = 'owner'): Promise<string> {
  const start = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/github`),
    env,
  )
  const state = new URL(start.headers.get('location') ?? '').searchParams.get(
    'state',
  )
  vi.stubGlobal('fetch', async (input: RequestInfo) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/user/emails')) return Response.json([])
    if (url.endsWith('/access_token'))
      return Response.json({ access_token: 'gho_x' })
    if (url.endsWith('/user'))
      return Response.json({ id: Number(OWNER_ID), login })
    return new Response(null, { status: 204 })
  })
  const oauth = start.headers.getSetCookie()[0]?.split(';')[0] ?? ''
  const callback = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/github/callback?code=c&state=${state}`, {
      headers: { Cookie: oauth },
    }),
    env,
  )
  vi.unstubAllGlobals()
  return (
    callback.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('__Host-slide_owner='))
      ?.split(';')[0] ?? ''
  )
}

/** Clears the tables that publication tests use. */
export async function resetTables(db: D1Database) {
  const orm = drizzle(db)
  // Decks and deployments reference each other, so pointers go first.
  await orm.batch([
    orm
      .update(decks)
      .set({ public_deployment_id: null, resume_deployment_id: null }),
    ...[
      citations,
      contentSessions,
      previewLaunches,
      uploadFiles,
      deployments,
      repositoryBindings,
      decks,
      authSession,
      authAccount,
      authUser,
      authVerification,
      accounts,
    ].map((table) => orm.delete(table)),
  ])
}

export async function seedDeck(db: D1Database, id: string, owner = OWNER_ID) {
  await drizzle(db)
    .insert(decks)
    .values({ id, owner_user_id: owner, created_at: 1 })
}

/** Inserts a deployment of the deck in the given upload state. */
export async function seedDeployment(
  db: D1Database,
  deck: string,
  state: 'uploading' | 'ready' | 'failed' | 'expired' = 'ready',
) {
  const id = crypto.randomUUID()
  await drizzle(db)
    .insert(deployments)
    .values({
      id,
      idempotency_key: `key-${id}`,
      inventory_digest: 'g',
      source_sha: 'b'.repeat(40),
      run_id: '7',
      run_attempt: '1',
      actor_id: OWNER_ID,
      repository_id: '1',
      owner_id: '2',
      source_ref: 'refs/heads/main',
      state,
      total_bytes: 1,
      token_hash: 'h',
      created_at: 1,
      expires_at: 2,
      credential_expires_at: 2,
      ready_at: state === 'ready' ? 1 : null,
      failure_reason: state === 'failed' ? 'author_bytes_exceeded' : null,
      deck_id: deck,
    })
  return id
}

/** A deck whose public pointer names a ready deployment of the given age. */
export async function seedPublic(
  db: D1Database,
  deck: string,
  readyAt: number,
  title: string | null,
  ownerId = OWNER_ID,
) {
  const orm = drizzle(db)
  await seedDeck(db, deck, ownerId)
  const id = await seedDeployment(db, deck)
  await orm.batch([
    orm
      .update(deployments)
      .set({ ready_at: readyAt, title })
      .where(eq(deployments.id, id)),
    orm
      .update(decks)
      .set({ public_deployment_id: id })
      .where(eq(decks.id, deck)),
  ])
  return id
}
