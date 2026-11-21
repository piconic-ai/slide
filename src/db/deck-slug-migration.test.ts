import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import server from '../app/routes'
import { accounts, decks } from './schema'
import { applyMigrations } from './test-migrations'
import {
  OWNER_ID,
  seedDeployment,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
afterAll(() => platform.dispose())

/** Makes the deck public as its owner "owner" would see it. */
async function publish(deck: string) {
  const deployment = await seedDeployment(database, deck)
  await db
    .update(decks)
    .set({ public_deployment_id: deployment })
    .where(eq(decks.id, deck))
}

beforeAll(async () => {
  await applyMigrations(database, { until: '0021_deck_takedowns.sql' })
  await db.run(sql`INSERT INTO decks (id, owner_user_id, created_at)
    VALUES ('before', ${OWNER_ID}, 1)`)
  await applyMigrations(database, {
    after: '0021_deck_takedowns.sql',
    until: '0022_deck_slug.sql',
  })
  // What the previous Worker does while a deploy or a rollback is under way:
  // it creates a deck without knowing the slug column.
  await db.run(sql`INSERT INTO decks (id, owner_user_id, created_at)
    VALUES ('during', ${OWNER_ID}, 2)`)
  // The later migrations, which drop the trigger once no such Worker is left.
  await applyMigrations(database, { after: '0022_deck_slug.sql' })
  await db.insert(accounts).values({
    user_id: OWNER_ID,
    handle: 'owner',
    created_at: 1,
  })
  await publish('before')
  await publish('during')
})

const open = (path: string) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)

test('Given a deck from before the migration, When the migration is applied, Then its slug is its id and its share URL opens it', async () => {
  const row = await db.select().from(decks).where(eq(decks.id, 'before')).get()

  expect(row?.slug).toBe('before')
  expect((await open('/@owner/before')).status).toBe(200)
})

test('Given a row inserted the old way without a slug, When it is looked up by slug, Then the trigger has given it the id as its slug', async () => {
  const row = await db.select().from(decks).where(eq(decks.id, 'during')).get()

  expect(row?.slug).toBe('during')
  expect((await open('/@owner/during')).status).toBe(200)
})

test('Given every migration, When they ran, Then no deck was lost, the slug index stays and the trigger is gone', async () => {
  expect(
    (await db.select({ id: decks.id }).from(decks)).map((row) => row.id).sort(),
  ).toEqual(['before', 'during'])
  expect(
    await db.all(
      sql`SELECT name FROM sqlite_master WHERE name IN ('decks_owner_slug', 'decks_slug_from_id') ORDER BY name`,
    ),
  ).toEqual([{ name: 'decks_owner_slug' }])
})
