import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { accounts, blocks, follows, mutes } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

// Every migration before this one, whatever its number in scope 3.
const BEFORE = '0051'
const BLOCKS = '0051_blocks.sql'

const existingState = async () => ({
  schema: await db.all(sql`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE tbl_name <> 'blocks' ORDER BY type, name`),
  accounts: await db.select().from(accounts),
  follows: await db.select().from(follows),
  mutes: await db.select().from(mutes),
})
let before: Awaited<ReturnType<typeof existingState>>

beforeAll(async () => {
  await applyMigrations(database, { until: BEFORE })
  await db.insert(accounts).values([
    { user_id: '1', handle: 'alice', created_at: 1 },
    { user_id: '2', handle: 'bob', created_at: 1 },
  ])
  await db.insert(follows).values([
    { follower_user_id: '1', followee_user_id: '2', created_at: 2 },
    { follower_user_id: '2', followee_user_id: '1', created_at: 3 },
  ])
  await db
    .insert(mutes)
    .values({ muter_user_id: '1', muted_user_id: '2', created_at: 4 })
  before = await existingState()
  await applyMigrations(database, { after: BEFORE, until: BLOCKS })
})
afterAll(() => platform.dispose())

test('F32-AC1: Given people, follows and mutes before 0051, When blocks are migrated, Then the existing schema and rows are unchanged', async () => {
  expect(await existingState()).toEqual(before)
})

test('F32-AC1: Given migration 0051, When its schema is inspected, Then blocks holds two user IDs and a time, keyed by the pair, with an index on the blocked side', async () => {
  expect(await db.all(sql`PRAGMA table_info('blocks')`)).toEqual([
    expect.objectContaining({ name: 'blocker_user_id', notnull: 1, pk: 1 }),
    expect.objectContaining({ name: 'blocked_user_id', notnull: 1, pk: 2 }),
    expect.objectContaining({ name: 'created_at', notnull: 1, pk: 0 }),
  ])
  expect(await db.all(sql`PRAGMA index_list('blocks')`)).toContainEqual(
    expect.objectContaining({ name: 'blocks_blocked' }),
  )
})

test('F32-AC11: Given migration 0051, When a block of oneself or a second block of the same pair is written, Then the database refuses it', async () => {
  await expect(
    db
      .insert(blocks)
      .values({ blocker_user_id: '1', blocked_user_id: '1', created_at: 1 }),
  ).rejects.toThrow()
  const pair = { blocker_user_id: '1', blocked_user_id: '2' }
  await db.insert(blocks).values({ ...pair, created_at: 1 })
  await expect(
    db.insert(blocks).values({ ...pair, created_at: 2 }),
  ).rejects.toThrow()
})
