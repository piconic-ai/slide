import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { backupObjects, backupState } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

beforeAll(() => applyMigrations(database))
afterAll(() => platform.dispose())

test('F39-AC29: Given migration 0068, When the state is read, Then there is one row, with no pass in progress and nothing recorded', async () => {
  expect(await db.select().from(backupState)).toEqual([
    {
      id: 1,
      pass_started_at: null,
      cursor: null,
      last_pass_started_at: null,
      last_completed_at: null,
      progress_at: null,
      last_run_at: null,
      last_run_failed: 0,
      last_failed_at: null,
      told_at: null,
    },
  ])
})

test('F39-AC29: Given the state table, When a second row or a cursor without a pass is written, Then it is refused', async () => {
  await expect(
    database.prepare('INSERT INTO backup_state (id) VALUES (2)').run(),
  ).rejects.toThrow()
  await expect(
    database.prepare("UPDATE backup_state SET cursor = 'k' WHERE id = 1").run(),
  ).rejects.toThrow()
})

test('F39-AC26: Given the objects table, When a key is written twice, Then the second is refused, so a copy has one row', async () => {
  const row = { key: 'a/0', etag: 'e', size: 1, copied_at: 1, gone_at: null }
  await db.insert(backupObjects).values(row)
  await expect(db.insert(backupObjects).values(row)).rejects.toThrow()
  await expect(
    db.insert(backupObjects).values({ ...row, key: '', copied_at: 2 }),
  ).rejects.toThrow()
  await expect(
    db.insert(backupObjects).values({ ...row, key: 'b', size: -1 }),
  ).rejects.toThrow()
})
