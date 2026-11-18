import { getTableColumns, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { mutes, notificationOptOuts, notifications } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

const existingState = async () => ({
  schema: await db.all(sql`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE tbl_name NOT IN ('notifications', 'notification_opt_outs')
    ORDER BY type, name`),
  mutes: await db.select().from(mutes),
})
let before: Awaited<ReturnType<typeof existingState>>

beforeAll(async () => {
  await applyMigrations(database, { until: '0026_mutes.sql' })
  await db.insert(mutes).values({
    muter_user_id: '11',
    muted_user_id: '22',
    created_at: 10,
  })
  before = await existingState()
  await applyMigrations(database, {
    after: '0026_mutes.sql',
    until: '0027_notifications.sql',
  })
})
afterAll(() => platform.dispose())

test('F20-AC3: Given an existing mute before 0027, When notification storage is added, Then the old schema and mute survive', async () => {
  expect(await existingState()).toEqual(before)
})

test('F20-AC3: Given migration 0027, When its tables are inspected, Then their column names and types match Drizzle', async () => {
  for (const [table, query] of [
    [notifications, sql`PRAGMA table_info('notifications')`],
    [notificationOptOuts, sql`PRAGMA table_info('notification_opt_outs')`],
  ] as const) {
    const columns = Object.values(getTableColumns(table)).map((column) => ({
      name: column.name,
      type: column.getSQLType().toUpperCase(),
    }))
    expect(await db.all(query)).toMatchObject(columns)
  }
})

test('F20-AC1: Given migration 0027, When the recipient index is inspected, Then it orders by recipient and creation time', async () => {
  expect(
    await db.all(sql`PRAGMA index_info('notifications_recipient')`),
  ).toMatchObject([{ name: 'recipient_user_id' }, { name: 'created_at' }])
})

test.each([
  ['cited', 'source', 'target'],
  ['followee_published', 'source', null],
  ['github_followee_joined', null, null],
  ['followed', null, null],
] as const)(
  'F20-AC3: Given the valid %s shape, When the event is inserted twice, Then only the first insert succeeds',
  async (kind, deck_id, target_deck_id) => {
    const row = {
      recipient_user_id: '11',
      actor_user_id: '22',
      kind,
      deck_id,
      target_deck_id,
    }
    await db.insert(notifications).values({ ...row, id: kind, created_at: 10 })
    await expect(
      db
        .insert(notifications)
        .values({ ...row, id: `again-${kind}`, created_at: 20 }),
    ).rejects.toThrow()
  },
)

test.each([
  ['cited', null, 'target'],
  ['cited', 'source', null],
  ['followee_published', null, null],
  ['followee_published', 'source', 'target'],
  ['github_followee_joined', 'source', null],
  ['github_followee_joined', null, 'target'],
  ['followed', 'source', null],
  ['followed', null, 'target'],
  ['unknown', null, null],
] as const)(
  'F20-AC3: Given kind %s with invalid deck IDs (%s, %s), When it is inserted, Then the shape constraint rejects it',
  async (kind, source, target) => {
    await expect(
      db.run(sql`INSERT INTO notifications
      (id, recipient_user_id, kind, actor_user_id, deck_id, target_deck_id, created_at)
      VALUES ('invalid', '33', ${kind}, '44', ${source}, ${target}, 10)`),
    ).rejects.toThrow()
  },
)

test('F20-AC3: Given an author citing their own deck, When a notification is inserted, Then the database refuses it', async () => {
  await expect(
    db.insert(notifications).values({
      id: 'self',
      recipient_user_id: '22',
      kind: 'cited',
      actor_user_id: '22',
      deck_id: 'source',
      target_deck_id: 'target',
      created_at: 10,
    }),
  ).rejects.toThrow()
})

test('F20-AC7: Given opt-outs for two kinds and two users, When one user opts out of the same kind again, Then only the duplicate is rejected', async () => {
  const setting = { user_id: '11', kind: 'cited' } as const
  await db
    .insert(notificationOptOuts)
    .values([
      setting,
      { user_id: '11', kind: 'github_followee_joined' },
      { user_id: '22', kind: 'cited' },
    ])
  await expect(db.insert(notificationOptOuts).values(setting)).rejects.toThrow()
})
