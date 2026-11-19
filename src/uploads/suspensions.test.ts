import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { deployments, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedDeck,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
const inventory = {
  attempt: 'suspension-test-attempt',
  entry: 'index.html',
  files: [{ path: 'index.html', size: 1, sha256: 'a'.repeat(64) }],
}
const sessions: Record<string, string> = {}

const start = (ownerId: string) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides/talk/uploads`, {
      method: 'POST',
      headers: {
        Cookie: sessions[ownerId] ?? '',
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(inventory),
    }),
    env,
  )

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await seedDeck(database, 'alice-talk', OWNER_ID, 'talk')
  await seedDeck(database, 'bob-talk', INVITED_ID, 'talk')
  sessions[OWNER_ID] = await signIn(env, 'alice')
  sessions[INVITED_ID] = await signIn(env, 'bob', { id: INVITED_ID })
})
afterAll(() => platform.dispose())

test('F17-AC15: Given two owners with a slide each, When one is suspended and both start uploads, Then the suspended owner is refused without creating a deployment and the other upload starts', async () => {
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
    await db.select({ deck: deployments.deck_id }).from(deployments),
  ).toEqual([{ deck: 'bob-talk' }])
})
