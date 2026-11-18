import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { accounts, decks, deployments, mutes, suspensions } from './schema'
import { applyMigrations } from './test-migrations'
import { OWNER_ID, seedPublic } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

const existingState = async () => ({
  schema: await db.all(sql`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE tbl_name <> 'mutes' ORDER BY type, name`),
  accounts: await db.select().from(accounts),
  decks: await db.select().from(decks),
  deployments: await db.select().from(deployments),
  suspensions: await db.select().from(suspensions),
})
let before: Awaited<ReturnType<typeof existingState>>

beforeAll(async () => {
  await applyMigrations(database, { until: '0025_suspensions.sql' })
  await db.insert(accounts).values({
    user_id: OWNER_ID,
    handle: 'owner',
    created_at: 1,
  })
  await seedPublic(database, 'talk', 10, 'Existing talk')
  await db.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'existing suspension',
    suspended_at: 20,
    suspended_by: 'op@example.com',
  })
  before = await existingState()
  await applyMigrations(database, {
    after: '0025_suspensions.sql',
    until: '0026_mutes.sql',
  })
})
afterAll(() => platform.dispose())

test('F19-AC2: Given existing tables and rows before 0026, When mutes are migrated, Then the existing schema and rows are unchanged', async () => {
  expect(await existingState()).toEqual(before)
})

test('F19-AC2: Given migration 0026, When its schema is inspected, Then mutes requires two user IDs and a timestamp with no foreign keys', async () => {
  expect(await db.all(sql`PRAGMA table_info('mutes')`)).toEqual([
    expect.objectContaining({
      name: 'muter_user_id',
      type: 'TEXT',
      notnull: 1,
      pk: 1,
    }),
    expect.objectContaining({
      name: 'muted_user_id',
      type: 'TEXT',
      notnull: 1,
      pk: 2,
    }),
    expect.objectContaining({
      name: 'created_at',
      type: 'INTEGER',
      notnull: 1,
      pk: 0,
    }),
  ])
  expect(await db.all(sql`PRAGMA foreign_key_list('mutes')`)).toEqual([])
})

test('F19-AC7: Given migration 0026, When the muter and the muted user are the same, Then the database refuses the row', async () => {
  await expect(
    db.insert(mutes).values({
      muter_user_id: OWNER_ID,
      muted_user_id: OWNER_ID,
      created_at: 10,
    }),
  ).rejects.toThrow()
})

test('F19-AC2: Given a mute, When the same pair is inserted at a later time, Then the primary key refuses the duplicate', async () => {
  const pair = { muter_user_id: OWNER_ID, muted_user_id: '1234' }
  await db.insert(mutes).values({ ...pair, created_at: 10 })
  await expect(
    db.insert(mutes).values({ ...pair, created_at: 20 }),
  ).rejects.toThrow()
})
