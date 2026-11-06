import { vi } from 'vitest'
import server from '../../server'

export const TEST_ORIGIN = 'https://slide.example'
export const OWNER_ID = '722500'

/** Test configuration for the management origin with owner login enabled. */
export function testEnv(platformEnv: Env): Env {
  return {
    ...platformEnv,
    GITHUB_APP_CLIENT_ID: 'Iv1.client',
    GITHUB_APP_CLIENT_SECRET: 'secret',
    PUBLIC_ORIGIN: TEST_ORIGIN,
  } as unknown as Env
}

/** Signs in as the allowed owner with GitHub stubbed; returns the cookie. */
export async function signIn(env: Env): Promise<string> {
  const start = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/github`),
    env,
  )
  const state = new URL(start.headers.get('location') ?? '').searchParams.get(
    'state',
  )
  vi.stubGlobal('fetch', async (input: RequestInfo) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/access_token'))
      return Response.json({ access_token: 'gho_x' })
    if (url.endsWith('/user'))
      return Response.json({ id: Number(OWNER_ID), login: 'owner' })
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
  // Decks and deployments reference each other, so pointers go first.
  await db.batch([
    db.prepare(
      'UPDATE decks SET public_deployment_id = NULL, resume_deployment_id = NULL',
    ),
    ...[
      'upload_files',
      'deployments',
      'repository_bindings',
      'decks',
      'owner_sessions',
    ].map((table) => db.prepare(`DELETE FROM ${table}`)),
  ])
}

export async function seedDeck(db: D1Database, id: string, owner = OWNER_ID) {
  await db
    .prepare(
      'INSERT INTO decks (id, owner_user_id, created_at) VALUES (?, ?, 1)',
    )
    .bind(id, owner)
    .run()
}

/** Inserts a deployment of the deck in the given upload state. */
export async function seedDeployment(
  db: D1Database,
  deck: string,
  state: 'uploading' | 'ready' | 'failed' | 'expired' = 'ready',
) {
  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO deployments (id, idempotency_key, inventory_digest, source_sha, run_id, run_attempt, actor_id, repository_id, owner_id, source_ref, state, total_bytes, token_hash, created_at, expires_at, credential_expires_at, ready_at, failure_reason, deck_id)
       VALUES (?, ?, 'g', ?, '7', '1', ?, '1', '2', 'refs/heads/main', ?, 1, 'h', 1, 2, 2, ?, ?, ?)`,
    )
    .bind(
      id,
      `key-${id}`,
      'b'.repeat(40),
      OWNER_ID,
      state,
      state === 'ready' ? 1 : null,
      state === 'failed' ? 'author_bytes_exceeded' : null,
      deck,
    )
    .run()
  return id
}
