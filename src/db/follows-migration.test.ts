import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { seedDeck, seedDeployment } from '../publication/test-support'
import { decks, deployments, follows } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

beforeAll(async () => {
  await applyMigrations(database, { until: '0027_notifications.sql' })
  for (const id of ['public', 'paused', 'draft']) await seedDeck(database, id)
  const current = await seedDeployment(database, 'public')
  const remembered = await seedDeployment(database, 'paused')
  await seedDeployment(database, 'draft')
  await db.batch([
    db
      .update(deployments)
      .set({ ready_at: 10 })
      .where(eq(deployments.id, current)),
    db
      .update(deployments)
      .set({ ready_at: 20 })
      .where(eq(deployments.id, remembered)),
    db
      .update(decks)
      .set({ public_deployment_id: current })
      .where(eq(decks.id, 'public')),
    db
      .update(decks)
      .set({ paused_at: 30, resume_deployment_id: remembered })
      .where(eq(decks.id, 'paused')),
  ])
  await applyMigrations(database, {
    after: '0027_notifications.sql',
    until: '0028_follows.sql',
  })
})
afterAll(() => platform.dispose())

test('Given public, paused and draft decks before 0028, When follows are migrated, Then only public and paused decks inherit their pointed deployment’s ready time', async () => {
  expect(
    await db
      .select({ id: decks.id, firstPublished: decks.first_published_at })
      .from(decks)
      .orderBy(decks.id),
  ).toEqual([
    { id: 'draft', firstPublished: null },
    { id: 'paused', firstPublished: 20 },
    { id: 'public', firstPublished: 10 },
  ])
})

test('Given migration 0028, When the previous Worker inserts a deck without its first publication time, Then the deck is saved as a draft', async () => {
  await db.run(
    sql`INSERT INTO decks (id, owner_user_id, created_at, slug) VALUES ('old-worker', '1', 40, 'old-worker')`,
  )
  expect(
    await db
      .select({
        firstPublished: decks.first_published_at,
        publicVersion: decks.public_deployment_id,
      })
      .from(decks)
      .where(eq(decks.id, 'old-worker'))
      .get(),
  ).toEqual({
    firstPublished: null,
    publicVersion: null,
  })
})

test('Given migration 0028, When its schema is inspected, Then follows requires the two user IDs and time and indexes the followee', async () => {
  expect(await db.all(sql`PRAGMA table_info('follows')`)).toMatchObject([
    { name: 'follower_user_id', type: 'TEXT', notnull: 1, pk: 1 },
    { name: 'followee_user_id', type: 'TEXT', notnull: 1, pk: 2 },
    { name: 'created_at', type: 'INTEGER', notnull: 1, pk: 0 },
  ])
  expect(
    await db.all(sql`PRAGMA index_info('follows_followee')`),
  ).toMatchObject([{ name: 'followee_user_id' }])
})

test('Given a stored follow, When the pair is repeated or a user follows themself, Then the database rejects those rows', async () => {
  const pair = { follower_user_id: '1', followee_user_id: '2', created_at: 1 }
  await db.insert(follows).values(pair)
  await expect(
    db.insert(follows).values({ ...pair, created_at: 2 }),
  ).rejects.toThrow()
  await expect(
    db.insert(follows).values({ ...pair, followee_user_id: '1' }),
  ).rejects.toThrow()
  expect(await db.select().from(follows)).toEqual([pair])
})
