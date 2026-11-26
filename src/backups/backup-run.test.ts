import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeEach, expect, test, vi } from 'vitest'
import { backupObjects, backupState } from '../db/schema'
import { runBackup } from './backup-routes'
import { EXPIRE_COST, pageCost, pageLimit } from './limits'
import { readState } from './backup-store'
import { emptyBucket, keysOf, openBuckets, sha256Of } from './test-buckets'

// Many suites share a machine in CI and locally, so a run through two buckets may be slow.
vi.setConfig({ testTimeout: 30_000 })

const platform = await openBuckets()
const { DB, UPLOADS: source, UPLOADS_BACKUP: backup } = platform.env
const db = drizzle(DB)
afterAll(() => platform.dispose())

const at = (day: number, hour: number) =>
  Date.UTC(2026, 10, day, hour, 17) / 1000
const FIRST = at(26, 18)
/** An environment with the three bindings the backup uses. */
const envOf = (bindings: Partial<Env> = {}) =>
  ({ DB, UPLOADS: source, UPLOADS_BACKUP: backup, ...bindings }) as Env
const env = envOf()

beforeEach(async () => {
  await emptyBucket(source)
  await emptyBucket(backup)
  await db.delete(backupObjects)
  await db
    .update(backupState)
    .set({
      pass_started_at: null,
      cursor: null,
      last_pass_started_at: null,
      last_completed_at: null,
      progress_at: null,
      last_run_at: null,
      last_run_failed: 0,
      last_failed_at: null,
      told_at: null,
    })
    .where(eq(backupState.id, 1))
})

const put = (key: string, body: string, contentType = 'text/html') =>
  source.put(key, body, { httpMetadata: { contentType } })

/** A bucket that counts its writes, and can be told to fail some. */
function counting(bucket: R2Bucket, failing: (call: number) => boolean) {
  const calls = { put: 0, list: [] as (string | undefined)[] }
  const wrapped = new Proxy(bucket, {
    get(target, name) {
      if (name === 'put')
        return (...args: Parameters<R2Bucket['put']>) => {
          calls.put += 1
          if (failing(calls.put)) throw new Error('the bucket is down')
          return target.put(...args)
        }
      if (name === 'list')
        return (options?: R2ListOptions) => {
          calls.list.push(options?.startAfter)
          return target.list(options)
        }
      const value = Reflect.get(target, name)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { wrapped, calls }
}

const trackedKeys = async () =>
  (await db.select().from(backupObjects).all()).map(({ key }) => key).sort()

test('F39-AC25: Given new files in the source, When the next pass runs, Then each is in the backup with the same bytes (SHA-256) and type', async () => {
  await put('d1/0/lease-a', '<h1>one</h1>')
  await put('d1/1/lease-b', 'body { color: red }', 'text/css')
  await source.put('avatars/user-1', new Uint8Array([1, 2, 3, 250, 255]), {
    httpMetadata: { contentType: 'image/png' },
  })

  const summary = await runBackup(env, FIRST)

  expect(summary).toEqual({ copied: 3, failed: 0, expired: 0 })
  expect(await keysOf(backup)).toEqual(await keysOf(source))
  for (const key of await keysOf(source))
    expect(await sha256Of(backup, key)).toBe(await sha256Of(source, key))
  expect((await backup.head('d1/1/lease-b'))?.httpMetadata?.contentType).toBe(
    'text/css',
  )
  expect(await trackedKeys()).toEqual(await keysOf(source))
})

test('F39-AC25: Given an empty file, When a pass runs, Then the empty file is copied too', async () => {
  await put('d1/0/empty', '')
  await runBackup(env, FIRST)
  expect((await backup.head('d1/0/empty'))?.size).toBe(0)
})

test('F39-AC25: Given the cache of a Gravatar and an export lock, When a pass runs, Then neither is copied', async () => {
  await put('gravatar/user-1', 'png')
  await put('exports/leases/user-1', 'lock')
  await put('d1/0/lease', 'kept')
  await runBackup(env, FIRST)
  expect(await keysOf(backup)).toEqual(['d1/0/lease'])
})

test('F39-AC25: Given a file put after the first pass, When the next day pass runs, Then only that file is copied', async () => {
  await put('d1/0/old', 'old')
  await runBackup(env, FIRST)
  await put('d2/0/new', 'new')
  const summary = await runBackup(env, at(27, 18))
  expect(summary).toEqual({ copied: 1, failed: 0, expired: 0 })
  expect(await keysOf(backup)).toEqual(['d1/0/old', 'd2/0/new'])
})

test('F39-AC25: Given a key put again with other content, When the next pass runs, Then the backup has the new content', async () => {
  await put('avatars/user-1', 'first picture')
  await runBackup(env, FIRST)
  await put('avatars/user-1', 'second picture')
  expect(await runBackup(env, at(27, 18))).toEqual({
    copied: 1,
    failed: 0,
    expired: 0,
  })
  expect(await sha256Of(backup, 'avatars/user-1')).toBe(
    await sha256Of(source, 'avatars/user-1'),
  )
})

test('F39-AC26: Given files already copied, When the next pass runs, Then none is written to the backup again', async () => {
  for (const key of ['a/0/x', 'a/1/y', 'b/0/z']) await put(key, key)
  await runBackup(env, FIRST)
  const { wrapped, calls } = counting(backup, () => false)
  const summary = await runBackup(
    envOf({ UPLOADS_BACKUP: wrapped }),
    at(27, 18),
  )
  expect(summary).toEqual({ copied: 0, failed: 0, expired: 0 })
  expect(calls.put).toBe(0)
})

test('F39-AC26: Given a firing at an hour that does not start a pass, When it runs after a finished pass, Then it does nothing, not even a listing', async () => {
  await put('a/0/x', 'x')
  await runBackup(env, FIRST)
  const { wrapped, calls } = counting(source, () => false)
  await runBackup(envOf({ UPLOADS: wrapped }), at(27, 3))
  expect(calls.list).toEqual([])
})

test('F39-AC29: Given more files than one run may copy, When the runs follow one another, Then every file is copied, and each run goes on from where the last one stopped', async () => {
  const keys = Array.from(
    { length: 25 },
    (_, i) => `d/${String(i).padStart(2, '0')}/f`,
  )
  for (const key of keys) await put(key, `content of ${key}`)
  // A budget for one page of 8 new files.
  const budget = pageCost(8) + EXPIRE_COST
  expect(pageLimit(budget - EXPIRE_COST)).toBe(8)

  const { wrapped, calls } = counting(source, () => false)
  const small = { budget }
  const first = await runBackup(envOf({ UPLOADS: wrapped }), FIRST, small)
  expect(first.copied).toBe(8)
  expect((await readState(DB)).pass).toMatchObject({
    kind: 'in_progress',
    cursor: 'd/07/f',
  })
  expect(await keysOf(backup)).toEqual(keys.slice(0, 8))

  // The next runs fall in hours that would start no pass, and go on.
  let hour = 19
  while ((await readState(DB)).pass.kind === 'in_progress') {
    await runBackup(envOf({ UPLOADS: wrapped }), at(26, hour++), small)
    expect(hour).toBeLessThan(30)
  }
  expect(await keysOf(backup)).toEqual(keys)
  for (const key of keys)
    expect(await sha256Of(backup, key)).toBe(await sha256Of(source, key))
  // The listing went on from the cursor, never from the start again.
  expect(calls.list[0]).toBeUndefined()
  expect(calls.list.slice(1).every((after) => after !== undefined)).toBe(true)
  expect((await readState(DB)).lastCompletedAt).not.toBeNull()
})

test('F39-AC29: Given a run that stops on an error, When the next run comes, Then it goes on from the last recorded page and no file is lost or copied twice', async () => {
  const keys = Array.from(
    { length: 12 },
    (_, i) => `d/${String(i).padStart(2, '0')}/f`,
  )
  for (const key of keys) await put(key, key)
  const small = { budget: pageCost(4) + EXPIRE_COST }
  await runBackup(env, FIRST, small)
  expect((await readState(DB)).pass).toMatchObject({ cursor: 'd/03/f' })

  // The source's listing fails during the second page.
  const failing = new Proxy(source, {
    get(target, name) {
      if (name === 'list')
        return () => Promise.reject(new Error('list is down'))
      const value = Reflect.get(target, name)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const failed = await runBackup(envOf({ UPLOADS: failing }), at(26, 19), small)
  expect(failed).toEqual({ copied: 0, failed: 1, expired: 0 })
  expect((await readState(DB)).pass).toMatchObject({ cursor: 'd/03/f' })

  const { wrapped, calls } = counting(backup, () => false)
  for (let hour = 20; (await readState(DB)).pass.kind === 'in_progress'; hour++)
    await runBackup(envOf({ UPLOADS_BACKUP: wrapped }), at(26, hour), small)
  expect(await keysOf(backup)).toEqual(keys)
  // 8 files were left, each written once.
  expect(calls.put).toBe(8)
})

test('F39-AC29: Given the backup bucket failing on its first files, When the pass runs, Then the page is given up without moving the cursor, and the next run copies the files', async () => {
  for (const key of ['a/0', 'a/1', 'a/2', 'a/3', 'a/4', 'a/5', 'a/6'])
    await put(key, key)
  const down = counting(backup, (call) => call <= 5)
  const first = await runBackup(envOf({ UPLOADS_BACKUP: down.wrapped }), FIRST)
  expect(first).toEqual({ copied: 0, failed: 5, expired: 0 })
  // Five failures end the page, so the sixth and seventh were not even tried.
  expect(down.calls.put).toBe(5)
  expect((await readState(DB)).pass).toEqual({
    kind: 'in_progress',
    startedAt: FIRST,
    cursor: null,
  })
  expect((await readState(DB)).lastRunFailed).toBe(5)

  const next = await runBackup(env, at(26, 19))
  expect(next).toEqual({ copied: 7, failed: 0, expired: 0 })
  expect((await readState(DB)).pass.kind).toBe('idle')
  expect((await readState(DB)).lastRunFailed).toBe(0)
})

test('F39-AC29: Given one file that cannot be copied among others, When the pass runs, Then the others are copied and the pass finishes', async () => {
  for (const key of ['a/0', 'a/1', 'a/2']) await put(key, key)
  const flaky = counting(backup, (call) => call === 2)
  const summary = await runBackup(
    envOf({ UPLOADS_BACKUP: flaky.wrapped }),
    FIRST,
  )
  expect(summary).toEqual({ copied: 2, failed: 1, expired: 0 })
  expect(await keysOf(backup)).toEqual(['a/0', 'a/2'])
  expect((await readState(DB)).pass.kind).toBe('idle')
  // The next day's pass copies the one that failed.
  expect(await runBackup(env, at(27, 18))).toEqual({
    copied: 1,
    failed: 0,
    expired: 0,
  })
  expect(await keysOf(backup)).toEqual(['a/0', 'a/1', 'a/2'])
})

test('F39-AC26: Given a file put again between the listing and the copy, When it is copied, Then the backup does not get a mix, and the next pass copies the new content', async () => {
  await put('a/0', 'first')
  const racing = new Proxy(source, {
    get(target, name) {
      if (name === 'get')
        return async (key: string, options?: R2GetOptions) => {
          await target.put(key, 'second')
          return target.get(key, options)
        }
      const value = Reflect.get(target, name)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  expect(await runBackup(envOf({ UPLOADS: racing }), FIRST)).toEqual({
    copied: 0,
    failed: 0,
    expired: 0,
  })
  expect(await keysOf(backup)).toEqual([])
  expect(await runBackup(env, at(27, 18))).toEqual({
    copied: 1,
    failed: 0,
    expired: 0,
  })
  expect(await sha256Of(backup, 'a/0')).toBe(await sha256Of(source, 'a/0'))
})

test('F39-AC27: Given a file deleted from the source, When the next pass runs, Then its copy stays in the backup, marked with the time it was found gone', async () => {
  await put('a/0', 'kept')
  await put('a/1', 'deleted')
  await runBackup(env, FIRST)
  await source.delete('a/1')
  await runBackup(env, at(27, 18))
  expect(await keysOf(backup)).toEqual(['a/0', 'a/1'])
  const rows = await db.select().from(backupObjects).all()
  expect(Object.fromEntries(rows.map((r) => [r.key, r.gone_at]))).toEqual({
    'a/0': null,
    'a/1': at(27, 18),
  })
})

test('F39-AC27: Given a file found gone twice, When the next pass runs, Then the time it was first found gone stays', async () => {
  await put('a/0', 'deleted')
  await runBackup(env, FIRST)
  await source.delete('a/0')
  await runBackup(env, at(27, 18))
  await runBackup(env, at(28, 18))
  const row = await db.select().from(backupObjects).get()
  expect(row?.gone_at).toBe(at(27, 18))
})

test('F39-AC27: Given a deleted file put again with the same content, When the next pass runs, Then it is not gone and is not copied again', async () => {
  await put('a/0', 'same')
  await runBackup(env, FIRST)
  await source.delete('a/0')
  await runBackup(env, at(27, 18))
  await put('a/0', 'same')
  const { wrapped, calls } = counting(backup, () => false)
  await runBackup(envOf({ UPLOADS_BACKUP: wrapped }), at(28, 18))
  expect(calls.put).toBe(0)
  expect((await db.select().from(backupObjects).get())?.gone_at).toBeNull()
})

test('F39-AC30: Given no backup bucket, When the task runs, Then it does nothing and writes nothing', async () => {
  await put('a/0', 'x')
  const summary = await runBackup(envOf({ UPLOADS_BACKUP: undefined }), FIRST)
  expect(summary).toEqual({ copied: 0, failed: 0, expired: 0 })
  expect(await keysOf(backup)).toEqual([])
  expect((await readState(DB)).lastRunAt).toBeNull()
  expect((await readState(DB)).lastPassStartedAt).toBeNull()
})

test('F39-AC25: Given an empty source, When a pass runs, Then it finishes with nothing copied', async () => {
  expect(await runBackup(env, FIRST)).toEqual({
    copied: 0,
    failed: 0,
    expired: 0,
  })
  expect((await readState(DB)).lastCompletedAt).toBe(FIRST)
})
