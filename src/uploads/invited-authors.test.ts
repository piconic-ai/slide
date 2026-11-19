import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { decks, deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'

// Every upload in this file is started by the invited author, signed in
// while both people are registered.
const platform = await getPlatformProxy<Env>({ persist: false })
const db = drizzle(platform.env.DB)
const onlyFirst = testEnv(platform.env)
const both = withInvited(onlyFirst)
const inventory = {
  attempt: 'invited-author-attempt',
  entry: 'index.html',
  files: [{ path: 'index.html', size: 1, sha256: 'a'.repeat(64) }],
}
let session = ''
const start = (deck: string, env: Env) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides/${deck}/uploads`, {
      method: 'POST',
      headers: {
        Cookie: session,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(inventory),
    }),
    env,
  )
const addDeck = (deck: string, owner: string) =>
  db
    .insert(decks)
    .values({ id: deck, slug: deck, owner_user_id: owner, created_at: 1 })

beforeAll(() => applyMigrations(platform.env.DB))
beforeEach(async () => {
  await resetTables(platform.env.DB)
  await db.batch([
    addDeck('alice-talk', OWNER_ID),
    addDeck('bob-talk', INVITED_ID),
  ])
  session = await signIn(both, 'bob', { id: INVITED_ID })
})
afterAll(() => platform.dispose())

test('F22-AC21: Given the invited author, When they start an upload to their own slide, Then the upload starts', async () => {
  const response = await start('bob-talk', both)

  expect(response.status).toBe(201)
  expect(
    await db
      .select({ deck: deployments.deck_id, source: deployments.source })
      .from(deployments),
  ).toEqual([{ deck: 'bob-talk', source: 'browser' }])
})

test('F22-AC23: Given the invited author, When they start an upload to another author’s slide, Then it looks like no slide and nothing is created', async () => {
  const response = await start('alice-talk', both)

  expect(response.status).toBe(404)
  expect(await db.$count(deployments)).toBe(0)
})

test('F22-AC24: Given an author removed from the registration, When they start an upload to their own slide with the session they still hold, Then it is refused', async () => {
  expect((await start('bob-talk', onlyFirst)).status).toBe(401)
  expect(await db.$count(deployments)).toBe(0)
})

test('F22-AC24: Given an upload the author started, When they are removed before it finishes, Then its credential stops working', async () => {
  const receipt = (await (await start('bob-talk', both)).json()) as {
    deploymentId: string
    credential: string
  }
  const read = (env: Env) =>
    server.fetch(
      new Request(`${TEST_ORIGIN}/api/uploads/${receipt.deploymentId}`, {
        headers: { Authorization: `Bearer ${receipt.credential}` },
      }),
      env,
    )

  expect((await read(both)).status).toBe(200)
  expect((await read(onlyFirst)).status).toBe(403)
})

test.each(['', `${OWNER_ID},${INVITED_ID},`, `${INVITED_ID},${INVITED_ID}`])(
  'Given the mistaken setting %j, When an author starts an upload, Then it is refused',
  async (value) => {
    const env = { ...both, AUTHOR_GITHUB_IDS: value } as unknown as Env

    expect((await start('bob-talk', env)).status).toBe(401)
    expect(await db.$count(deployments)).toBe(0)
  },
)
