import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { decks, deployments, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { runUploadCleanup } from './cleanup'
import { DEFAULT_UPLOAD_LIMITS } from './limits'
import { readQuotaUsage } from './start-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = drizzle(platform.env.DB)
const bucket = platform.env.UPLOADS
const now = Math.floor(Date.now() / 1000)
// Far enough ahead that every object written by the test is past its grace.
const later = now + 2 * DEFAULT_UPLOAD_LIMITS.orphanGraceSeconds

beforeAll(() => applyMigrations(platform.env.DB))
beforeEach(async () => {
  await db.batch([
    db.delete(uploadFiles),
    db.delete(deployments),
    db.delete(decks),
    db
      .insert(decks)
      .values({ id: 'talk', owner_user_id: '722500', created_at: 1 }),
  ])
  const listed = await bucket.list()
  if (listed.objects.length)
    await bucket.delete(listed.objects.map(({ key }) => key))
})
afterAll(() => platform.dispose())

async function seed(
  id: string,
  state: 'uploading' | 'ready' | 'failed',
  expiresAt: number,
  keys: { referenced?: string; orphan?: string },
) {
  await db.insert(deployments).values({
    id,
    idempotency_key: `key-${id}`,
    inventory_digest: 'digest',
    source_sha: 'a'.repeat(40),
    run_id: '1',
    run_attempt: '1',
    actor_id: '722500',
    repository_id: '1446590227',
    owner_id: '248307881',
    source_ref: 'refs/heads/main',
    state,
    total_bytes: 1,
    token_hash: 'hash',
    created_at: now - 10,
    expires_at: expiresAt,
    credential_expires_at: expiresAt,
    ready_at: state === 'ready' ? now - 5 : null,
    failure_reason: state === 'failed' ? 'file_too_large' : null,
    deck_id: 'talk',
  })
  await db.insert(uploadFiles).values({
    deployment_id: id,
    id: '0',
    path: 'index.html',
    size: 1,
    sha256: 'b'.repeat(64),
    media_type: 'text/html',
    object_key: keys.referenced ?? null,
  })
  for (const key of [keys.referenced, keys.orphan])
    if (key) await bucket.put(key, 'a')
}
const state = async (id: string) =>
  db
    .select({ state: deployments.state, swept_at: deployments.swept_at })
    .from(deployments)
    .where(eq(deployments.id, id))
    .get()
const keys = async () => (await bucket.list()).objects.map(({ key }) => key)

test('given an expired session with objects, when cleanup runs repeatedly, then it is closed, emptied, and releases its reservation once', async () => {
  await seed('old', 'uploading', now - 1, {
    referenced: 'old/0/a',
    orphan: 'old/0/b',
  })
  expect((await readQuotaUsage(db, '722500', now)).activeSessions).toBe(0)
  expect(await runUploadCleanup(platform.env, now)).toEqual({
    expired: 1,
    swept: 0,
    failed: 0,
    deletedObjects: 0,
  })
  expect(await state('old')).toEqual({ state: 'expired', swept_at: null })
  expect(await runUploadCleanup(platform.env, later)).toEqual({
    expired: 0,
    swept: 1,
    failed: 0,
    deletedObjects: 2,
  })
  expect(await keys()).toEqual([])
  const file = await db
    .select({ object_key: uploadFiles.object_key })
    .from(uploadFiles)
    .get()
  expect(file?.object_key).toBeNull()
  expect(await runUploadCleanup(platform.env, later)).toEqual({
    expired: 0,
    swept: 0,
    failed: 0,
    deletedObjects: 0,
  })
  expect(await readQuotaUsage(db, '722500', later)).toEqual({
    storedBytes: 0,
    reservedBytes: 0,
    activeSessions: 0,
    // An expired session still counted as a start in its window.
    startsInWindow: 1,
  })
})

test('given a ready deployment with a late orphan, when cleanup runs repeatedly, then only the orphan is removed', async () => {
  await seed('done', 'ready', now + 100, {
    referenced: 'done/0/a',
    orphan: 'done/0/late',
  })
  expect((await runUploadCleanup(platform.env, now)).swept).toBe(0)
  expect(await runUploadCleanup(platform.env, later)).toMatchObject({
    swept: 1,
    deletedObjects: 1,
  })
  expect((await runUploadCleanup(platform.env, later)).swept).toBe(0)
  expect(await keys()).toEqual(['done/0/a'])
  expect(await state('done')).toEqual({ state: 'ready', swept_at: later })
  expect((await readQuotaUsage(db, '722500', later)).storedBytes).toBe(1)
})

test('given an open session and a failed deployment, when cleanup runs, then the open session is untouched', async () => {
  await seed('open', 'uploading', later + 100, { referenced: 'open/0/a' })
  await seed('refused', 'failed', now + 10, {})
  expect(await runUploadCleanup(platform.env, later)).toEqual({
    expired: 0,
    swept: 1,
    failed: 0,
    deletedObjects: 0,
  })
  expect(await state('open')).toEqual({ state: 'uploading', swept_at: null })
  expect(await keys()).toEqual(['open/0/a'])
})

test('given one deployment whose sweep fails, when cleanup runs, then the others are still swept and the failure is retried', async () => {
  await seed('broken', 'ready', now + 100, { orphan: 'broken/0/late' })
  await seed('fine', 'ready', now + 100, { orphan: 'fine/0/late' })
  const failing = {
    ...platform.env,
    UPLOADS: {
      list: (options: R2ListOptions) =>
        options.prefix === 'broken/'
          ? Promise.reject(new Error('R2 unavailable'))
          : bucket.list(options),
      delete: (keys: string | string[]) => bucket.delete(keys),
    } as unknown as R2Bucket,
  }
  expect(await runUploadCleanup(failing, later)).toMatchObject({
    swept: 1,
    failed: 1,
    deletedObjects: 1,
  })
  expect(await state('broken')).toMatchObject({ swept_at: null })
  // The failure is deferred, so it does not hold a batch slot meanwhile.
  expect(await runUploadCleanup(platform.env, later)).toMatchObject({
    swept: 0,
    failed: 0,
  })
  expect(
    await runUploadCleanup(platform.env, later + 6 * 60 * 60),
  ).toMatchObject({
    swept: 1,
    failed: 0,
    deletedObjects: 1,
  })
  expect(await keys()).toEqual([])
})

test('given an expired deployment with a young object, when cleanup runs, then receipts stay until the object can go', async () => {
  await seed('fresh', 'uploading', now - 1, { referenced: 'fresh/0/a' })
  // Not yet past the grace period for the object written just now.
  const soon = now + 10
  await runUploadCleanup(platform.env, now)
  await db
    .update(deployments)
    .set({ expires_at: soon - DEFAULT_UPLOAD_LIMITS.orphanGraceSeconds })
    .where(eq(deployments.id, 'fresh'))
  expect(await runUploadCleanup(platform.env, soon)).toMatchObject({
    swept: 0,
    deletedObjects: 0,
  })
  const file = await db
    .select({ object_key: uploadFiles.object_key })
    .from(uploadFiles)
    .get()
  expect(file?.object_key).toBe('fresh/0/a')
  expect(await keys()).toEqual(['fresh/0/a'])
})
