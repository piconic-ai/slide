import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { accounts, decks, deployments, reports, suspensions } from './schema'
import { applyMigrations } from './test-migrations'
import { OWNER_ID, seedDeck, seedDeployment } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

const existingSchema = () =>
  db.all(sql`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE tbl_name <> 'suspensions' ORDER BY type, name`)
const existingRows = async () => ({
  accounts: await db.select().from(accounts).orderBy(accounts.user_id),
  decks: await db.all(sql`SELECT * FROM decks ORDER BY id`),
  deployments: await db.select().from(deployments).orderBy(deployments.id),
  reports: await db.select().from(reports).orderBy(reports.id),
})
let previousSchema: Awaited<ReturnType<typeof existingSchema>>
let previousRows: Awaited<ReturnType<typeof existingRows>>

beforeAll(async () => {
  await applyMigrations(database, { until: '0024_reports.sql' })
  await db.insert(accounts).values({
    user_id: OWNER_ID,
    handle: 'owner',
    created_at: 1,
  })
  await seedDeck(database, 'before')
  await seedDeck(database, 'another')
  const deploymentId = await seedDeployment(database, 'before')
  await seedDeployment(database, 'another', 'uploading')
  await db
    .update(decks)
    .set({
      public_deployment_id: deploymentId,
      hidden_at: 10,
      hidden_reason: 'existing takedown',
      hidden_by: 'op@example.com',
    })
    .where(eq(decks.id, 'before'))
  await db.insert(reports).values({
    id: 'existing-report',
    deck_id: 'before',
    deployment_id: deploymentId,
    share_path: '/@owner/before',
    reason: 'nuisance',
    note: 'existing note',
    reporter_user_id: '1234',
    created_at: 1,
    updated_at: 2,
  })
  previousSchema = await existingSchema()
  previousRows = await existingRows()
  await applyMigrations(database, {
    after: '0024_reports.sql',
    until: '0025_suspensions.sql',
  })
})
afterAll(() => platform.dispose())

test('F17-AC15: Given existing tables and rows before 0025, When suspensions are migrated, Then the existing schema and rows are unchanged', async () => {
  expect(await existingSchema()).toEqual(previousSchema)
  expect(await existingRows()).toEqual(previousRows)
})

test('F17-AC15: Given migration 0025, When its schema is inspected, Then suspensions has a user ID primary key and required details without foreign keys', async () => {
  expect(await db.all(sql`PRAGMA table_info('suspensions')`)).toEqual([
    expect.objectContaining({ name: 'user_id', type: 'TEXT', pk: 1 }),
    expect.objectContaining({ name: 'reason', type: 'TEXT', notnull: 1 }),
    expect.objectContaining({
      name: 'suspended_at',
      type: 'INTEGER',
      notnull: 1,
    }),
    expect.objectContaining({ name: 'suspended_by', type: 'TEXT', notnull: 1 }),
  ])
  expect(await db.all(sql`PRAGMA foreign_key_list('suspensions')`)).toEqual([])
  expect(await db.select().from(suspensions)).toEqual([])
})

test('F17-AC15: Given a suspension keyed by GitHub user ID, When the account row is deleted, Then the suspension survives and an unknown account can also be suspended', async () => {
  const row = {
    user_id: '5678',
    reason: 'fake sign-in page',
    suspended_at: 300,
    suspended_by: 'op@example.com',
  }
  await db.insert(accounts).values({
    user_id: row.user_id,
    handle: 'departing',
    created_at: 1,
  })
  await db.insert(suspensions).values(row)
  await db.delete(accounts).where(eq(accounts.user_id, row.user_id))
  expect(
    await db
      .select()
      .from(suspensions)
      .where(eq(suspensions.user_id, row.user_id))
      .get(),
  ).toEqual(row)
  await db.insert(suspensions).values({ ...row, user_id: 'unknown' })
  await expect(db.insert(suspensions).values(row)).rejects.toThrow()
})

test.each(['reason', 'suspended_at', 'suspended_by'] as const)(
  'F17-AC15: Given migration 0025, When a suspension has no %s, Then the row is rejected',
  async (column) => {
    const row = {
      user_id: `missing-${column}`,
      reason: 'fake sign-in page',
      suspended_at: 300,
      suspended_by: 'op@example.com',
      [column]: null,
    }
    await expect(
      db.run(sql`INSERT INTO suspensions (user_id, reason, suspended_at, suspended_by)
        VALUES (${row.user_id}, ${row.reason}, ${row.suspended_at}, ${row.suspended_by})`),
    ).rejects.toThrow()
  },
)
