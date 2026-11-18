import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { deployments, repositoryBindings, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedDeck,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { verifyGitHubToken } from './oidc'

// Only GitHub's external identity verification is replaced.
vi.mock('./oidc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./oidc')>()),
  verifyGitHubToken: vi.fn(),
}))

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
const inventory = {
  entry: 'index.html',
  files: [{ path: 'index.html', size: 1, sha256: 'a'.repeat(64) }],
}

async function bind(deckId: string, ownerId: string) {
  await seedDeck(database, deckId, ownerId, 'talk')
  await db.insert(repositoryBindings).values({
    deck_id: deckId,
    repository_id: '1446590227',
    repository_owner_id: '248307881',
    repository_full_name: 'piconic-ai/slide',
    allowed_refs: '["refs/heads/main"]',
    verified_by: ownerId,
    verified_at: 1,
  })
}

const start = (ownerId: string) => {
  vi.mocked(verifyGitHubToken).mockResolvedValue({
    repository_id: '1446590227',
    repository_owner_id: '248307881',
    actor_id: ownerId,
    ref: 'refs/heads/main',
    sha: 'a'.repeat(40),
    run_id: '1',
    run_attempt: '1',
    event_name: 'push',
  })
  return server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides/talk/uploads`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer local-oidc-token-123456789',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(inventory),
    }),
    env,
  )
}

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await bind('alice-talk', OWNER_ID)
  await bind('bob-talk', INVITED_ID)
})
afterAll(() => platform.dispose())

test('F17-AC15: Given two owners with connected decks, When one is suspended and both start uploads, Then the suspended owner is refused without creating a deployment and the other upload starts', async () => {
  await db.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'fake sign-in page',
    suspended_at: 300,
    suspended_by: 'op@example.com',
  })

  expect((await start(OWNER_ID)).status).toBe(403)
  expect(await db.select().from(deployments)).toEqual([])
  expect((await start(INVITED_ID)).status).toBe(201)
  expect(
    await db
      .select({ deck: deployments.deck_id, actor: deployments.actor_id })
      .from(deployments),
  ).toEqual([{ deck: 'bob-talk', actor: INVITED_ID }])
})
