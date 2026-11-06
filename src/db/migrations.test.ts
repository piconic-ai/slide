import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
afterAll(() => platform.dispose())

test('given deployments from the first slice, when session states are migrated, then rows and file maps are kept', async () => {
  const db = platform.env.DB
  await applyMigrations(db, { until: '0001_uploads.sql' })
  const insert = `INSERT INTO deployments VALUES (?, ?, 'digest', ?, '1', '1', '722500', '1446590227', '248307881', 'refs/heads/main', ?, 1, 'hash', 10, 100, NULL, NULL, ?)`
  await db.batch([
    db.prepare(insert).bind('up', 'key-up', 'a'.repeat(40), 'uploading', null),
    db.prepare(insert).bind('done', 'key-done', 'b'.repeat(40), 'ready', 50),
    db
      .prepare(insert.replace(', 100,', ', 9999999999,'))
      .bind('late', 'key-late', 'd'.repeat(40), 'uploading', null),
    db
      .prepare(
        `INSERT INTO upload_files VALUES ('done', '0', 'index.html', 1, ?, 'text/html', 'done/0/lease')`,
      )
      .bind('c'.repeat(64)),
  ])
  await applyMigrations(db, { after: '0001_uploads.sql' })
  const rows = await db
    .prepare(
      'SELECT id, state, expires_at, credential_expires_at, ready_at, failure_reason FROM deployments ORDER BY id',
    )
    .all()
  expect(rows.results).toEqual([
    {
      id: 'done',
      state: 'ready',
      expires_at: 100,
      credential_expires_at: 100,
      ready_at: 50,
      failure_reason: null,
    },
    {
      id: 'late',
      state: 'uploading',
      expires_at: 9999999999,
      credential_expires_at: expect.any(Number),
      ready_at: null,
      failure_reason: null,
    },
    {
      id: 'up',
      state: 'uploading',
      expires_at: 100,
      credential_expires_at: 100,
      ready_at: null,
      failure_reason: null,
    },
  ])
  const file = await db
    .prepare('SELECT object_key FROM upload_files')
    .first<{ object_key: string }>()
  expect(file?.object_key).toBe('done/0/lease')
  const violations = await db.prepare('PRAGMA foreign_key_check').all()
  expect(violations.results).toEqual([])
  await expect(
    db.prepare("UPDATE deployments SET state = 'failed' WHERE id = 'up'").run(),
  ).rejects.toThrow()
  await expect(
    db.prepare("UPDATE deployments SET state = 'ready' WHERE id = 'up'").run(),
  ).rejects.toThrow()
})

test('given a long-lived session from the first slice, when migrated, then its credential is capped to one hour', async () => {
  const row = await platform.env.DB.prepare(
    "SELECT credential_expires_at FROM deployments WHERE id = 'late'",
  ).first<{ credential_expires_at: number }>()
  const now = Math.floor(Date.now() / 1000)
  expect(row?.credential_expires_at).toBeGreaterThan(now + 3500)
  expect(row?.credential_expires_at).toBeLessThanOrEqual(now + 3600)
})
