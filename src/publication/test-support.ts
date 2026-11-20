import { eq, sql } from 'drizzle-orm'
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
  follows,
  mutes,
  notificationOptOuts,
  notifications,
  previewLaunches,
  profiles,
  reports,
  repositoryBindings,
  suspensions,
  uploadFiles,
} from '../db/schema'
import server from '../../server'

export const TEST_ORIGIN = 'https://slide.example'
export const OWNER_ID = '722500'
/** A second person, an author only where a test registers them. */
export const INVITED_ID = '1234'

/** The environment with both people registered as authors. */
export const withInvited = (env: Env): Env =>
  ({ ...env, AUTHOR_GITHUB_IDS: `${OWNER_ID},${INVITED_ID}` }) as unknown as Env

/** Test configuration for the management origin with owner login enabled. */
export function testEnv(platformEnv: Env): Env {
  return {
    ...platformEnv,
    GITHUB_APP_CLIENT_ID: 'Iv1.client',
    GITHUB_APP_CLIENT_SECRET: 'secret',
    BETTER_AUTH_SECRET: 'test-only-better-auth-secret-32-bytes-long',
    PUBLIC_ORIGIN: TEST_ORIGIN,
    BROWSER: { quickAction: async () => stubCover() },
  } as unknown as Env
}

// A red 2×1 PNG; browsers draw it whatever type it is sent under.
const STUB_COVER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
)
/** Stands in for a cover a browser would take; no test starts a browser. */
const stubCover = () =>
  new Response(STUB_COVER, { headers: { 'Content-Type': 'image/jpeg' } })

/**
 * Signs in with GitHub stubbed; returns the cookie, empty when the sign-in
 * was refused. `github.id` is the GitHub user ID that answers, the first
 * author's by default. `github.profile` adds to what GitHub answers for the
 * user, and
 * `github.sponsors` is its answer about a Sponsors page: none by default,
 * as when GitHub does not say.
 */
export async function signIn(
  env: Env,
  login = 'owner',
  github: {
    id?: string
    profile?: Record<string, unknown>
    sponsors?: boolean
    followers?: (request: Request) => Response | Promise<Response>
  } = {},
): Promise<string> {
  const start = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/github`),
    env,
  )
  const state = new URL(start.headers.get('location') ?? '').searchParams.get(
    'state',
  )
  vi.stubGlobal('fetch', async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (new URL(url).pathname.endsWith('/followers'))
      return github.followers?.(new Request(input, init)) ?? Response.json([])
    if (url.endsWith('/user/emails')) return Response.json([])
    if (url.endsWith('/access_token'))
      return Response.json({ access_token: `gho_${github.id ?? OWNER_ID}` })
    if (url.endsWith('/user'))
      return Response.json({
        ...github.profile,
        id: Number(github.id ?? OWNER_ID),
        login,
      })
    if (url.endsWith('/graphql') && github.sponsors !== undefined)
      return Response.json({
        data: { viewer: { hasSponsorsListing: github.sponsors } },
      })
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
      reports,
      suspensions,
      follows,
      mutes,
      notificationOptOuts,
      notifications,
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
      profiles,
    ].map((table) => orm.delete(table)),
  ])
}

/** Inserts a deck; its slug is its id unless the test names another. */
export async function seedDeck(
  db: D1Database,
  id: string,
  owner = OWNER_ID,
  slug = id,
) {
  // Historical migration tests also use this fixture before newer columns exist.
  await drizzle(db)
    .run(sql`INSERT INTO decks (id, slug, owner_user_id, created_at)
    VALUES (${id}, ${slug}, ${owner}, 1)`)
}

/**
 * Inserts a deployment of the deck in the given upload state. Historical
 * migration tests also use this fixture on a schema from before 0029, where
 * a deployment still names the workflow that sent it.
 */
export async function seedDeployment(
  db: D1Database,
  deck: string,
  state: 'uploading' | 'ready' | 'failed' | 'expired' = 'ready',
) {
  const id = crypto.randomUUID()
  const orm = drizzle(db)
  const readyAt = state === 'ready' ? 1 : null
  const failureReason = state === 'failed' ? 'author_bytes_exceeded' : null
  const beforeSource = await orm.get(
    sql`SELECT 1 FROM pragma_table_info('deployments') WHERE name = 'source_sha'`,
  )
  if (beforeSource) {
    await orm.run(sql`INSERT INTO deployments
      (id, idempotency_key, inventory_digest, source_sha, run_id, run_attempt,
       actor_id, repository_id, owner_id, source_ref, state, total_bytes,
       token_hash, created_at, expires_at, credential_expires_at, ready_at,
       failure_reason, deck_id)
      VALUES (${id}, ${`key-${id}`}, 'g', ${'b'.repeat(40)}, '7', '1',
        ${OWNER_ID}, '1', '2', 'refs/heads/main', ${state}, 1, 'h', 1, 2, 2,
        ${readyAt}, ${failureReason}, ${deck})`)
    return id
  }
  await orm.insert(deployments).values({
    id,
    idempotency_key: `key-${id}`,
    inventory_digest: 'g',
    source: 'browser',
    state,
    total_bytes: 1,
    token_hash: 'h',
    created_at: 1,
    expires_at: 2,
    credential_expires_at: 2,
    ready_at: readyAt,
    failure_reason: failureReason,
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
  slug = deck,
) {
  const orm = drizzle(db)
  await seedDeck(db, deck, ownerId, slug)
  const id = await seedDeployment(db, deck)
  await orm.batch([
    orm
      .update(deployments)
      .set({ ready_at: readyAt, title })
      .where(eq(deployments.id, id)),
    orm
      .update(decks)
      .set({ public_deployment_id: id, first_published_at: readyAt })
      .where(eq(decks.id, deck)),
  ])
  return id
}
