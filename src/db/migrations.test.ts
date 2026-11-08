import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { deployments, uploadFiles } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
afterAll(() => platform.dispose())

test('given deployments from the first slice, when session states are migrated, then rows and file maps are kept', async () => {
  const database = platform.env.DB
  const db = drizzle(database)
  await applyMigrations(database, { until: '0001_uploads.sql' })
  for (const [id, sourceSha, state, expiresAt, readyAt] of [
    ['up', 'a'.repeat(40), 'uploading', 100, null],
    ['done', 'b'.repeat(40), 'ready', 100, 50],
    ['late', 'd'.repeat(40), 'uploading', 9999999999, null],
  ]) {
    await db.run(sql`INSERT INTO deployments VALUES (
      ${id}, ${`key-${id}`}, 'digest', ${sourceSha}, '1', '1', '722500',
      '1446590227', '248307881', 'refs/heads/main', ${state}, 1, 'hash',
      10, ${expiresAt}, NULL, NULL, ${readyAt})`)
  }
  await db.run(sql`INSERT INTO upload_files VALUES
    ('done', '0', 'index.html', 1, ${'c'.repeat(64)}, 'text/html', 'done/0/lease')`)
  await applyMigrations(database, { after: '0001_uploads.sql' })
  const rows = await db
    .select({
      id: deployments.id,
      state: deployments.state,
      expires_at: deployments.expires_at,
      credential_expires_at: deployments.credential_expires_at,
      ready_at: deployments.ready_at,
      failure_reason: deployments.failure_reason,
    })
    .from(deployments)
    .orderBy(deployments.id)
  expect(rows).toEqual([
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
    .select({ object_key: uploadFiles.object_key })
    .from(uploadFiles)
    .get()
  expect(file?.object_key).toBe('done/0/lease')
  expect(await db.all(sql`PRAGMA foreign_key_check`)).toEqual([])
  await expect(
    db
      .update(deployments)
      .set({ state: 'failed' })
      .where(eq(deployments.id, 'up'))
      .run(),
  ).rejects.toThrow()
  await expect(
    db
      .update(deployments)
      .set({ state: 'ready' })
      .where(eq(deployments.id, 'up'))
      .run(),
  ).rejects.toThrow()
})

test('given a long-lived session from the first slice, when migrated, then its credential is capped to one hour', async () => {
  const row = await drizzle(platform.env.DB)
    .select({ credential_expires_at: deployments.credential_expires_at })
    .from(deployments)
    .where(eq(deployments.id, 'late'))
    .get()
  const now = Math.floor(Date.now() / 1000)
  expect(row?.credential_expires_at).toBeGreaterThan(now + 3500)
  expect(row?.credential_expires_at).toBeLessThanOrEqual(now + 3600)
})
