import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, deployments, uploadFiles } from '../db/schema'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../db/test-migrations'
import { startAsAuthor } from '../uploads/test-start'
import { parseDeckPublication } from './state'
import { signIn, testEnv } from './test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)

let session = ''
beforeAll(async () => {
  await applyMigrations(db)
  session = await signIn(testEnv(platform.env))
})
beforeEach(async () => {
  await orm.batch([
    orm.delete(uploadFiles),
    orm.delete(deployments),
    orm.delete(decks),
  ])
  await orm.batch([
    orm.insert(decks).values({
      id: 'talk',
      slug: 'talk',
      owner_user_id: '722500',
      created_at: 1,
    }),
  ])
})
afterAll(() => platform.dispose())

const readDeck = () => orm.select().from(decks).get()

test('F02-AC62: Given a deck revision, When an upload starts, Then the revision is unchanged and the deck stays a draft', async () => {
  await orm.update(decks).set({ revision: 7 })
  const response = await startAsAuthor(platform.env, session, 'talk', {
    entry: 'index.html',
    files: [{ path: 'index.html', size: 1, sha256: 'a'.repeat(64) }],
  })
  expect(response.status).toBe(201)
  expect(await orm.$count(deployments)).toBe(1)
  expect(await readDeck()).toMatchObject({ revision: 7 })
  expect(parseDeckPublication(await readDeck()).publication).toEqual({
    kind: 'draft',
  })
})

const insertDeployment = (id: string) =>
  orm.insert(deployments).values({
    id,
    idempotency_key: id,
    inventory_digest: 'g',
    source: 'browser',
    state: 'ready',
    total_bytes: 1,
    token_hash: 'h',
    created_at: 1,
    expires_at: 2,
    credential_expires_at: 2,
    ready_at: 1,
    deck_id: 'talk',
  })

test.each([
  ['public while paused', "paused_at = 1, public_deployment_id = 'd'"],
  ['resume target while not paused', "resume_deployment_id = 'd'"],
  ['negative revision', 'revision = -1'],
  [
    'a deleted deck that still points at a version',
    "deleted_at = 1, public_deployment_id = 'd'",
  ],
])(
  'Given %s, When stored, Then a CHECK constraint rejects it',
  async (_, assignment) => {
    await insertDeployment('d')
    await expect(
      orm.run(sql`UPDATE decks SET ${sql.raw(assignment)}`),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringMatching(/CHECK constraint failed/),
      }),
    })
  },
)

test('Given an unknown deployment, When pointed to, Then the foreign key rejects it', async () => {
  await orm.run(sql`PRAGMA foreign_keys = ON`)
  await expect(
    orm.update(decks).set({ public_deployment_id: 'missing' }),
  ).rejects.toMatchObject({
    cause: expect.objectContaining({
      message: expect.stringMatching(/FOREIGN KEY constraint failed/),
    }),
  })
})
