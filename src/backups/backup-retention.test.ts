import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeEach, expect, test, vi } from 'vitest'
import { alerts, backupObjects, backupState, mailOutbox } from '../db/schema'
import { readOutbox } from '../mail/outbox-store'
import { sendDigest } from '../alerts/digest-routes'
import { notifierOf } from '../alerts/notify-routes'
import { runBackup } from './backup-routes'
import { readState } from './backup-store'
import { EXPIRE_COST, RETENTION_SECONDS, pageCost } from './limits'
import { emptyBucket, keysOf, openBuckets } from './test-buckets'
import { eq } from 'drizzle-orm'

const platform = await openBuckets()
const { DB, UPLOADS: source, UPLOADS_BACKUP: backup } = platform.env
const db = drizzle(DB)
afterAll(() => platform.dispose())

const DAY = 24 * 60 * 60
const at = (day: number, hour = 18) => Date.UTC(2026, 10, day, hour, 17) / 1000
const FIRST = at(26)
const envOf = (bindings: Record<string, unknown> = {}) =>
  ({
    DB,
    UPLOADS: source,
    UPLOADS_BACKUP: backup,
    ...bindings,
  }) as unknown as Env
const env = envOf()

beforeEach(async () => {
  await emptyBucket(source)
  await emptyBucket(backup)
  await db.delete(backupObjects)
  await db.delete(alerts)
  await db.delete(mailOutbox)
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

const put = (key: string, body: string) => source.put(key, body)
const goneAtOf = async (key: string) =>
  (
    await db
      .select()
      .from(backupObjects)
      .where(eq(backupObjects.key, key))
      .get()
  )?.gone_at

/** The backup bucket, failing its deletes or its writes when told to. */
function failing(bucket: R2Bucket, what: 'put' | 'delete', on: () => boolean) {
  return new Proxy(bucket, {
    get(target, name) {
      if (name === what)
        return (...args: unknown[]) => {
          if (on()) throw new Error('the bucket is down')
          return (target[what] as (...a: unknown[]) => unknown)(...args)
        }
      const value = Reflect.get(target, name)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

test('F39-AC27: Given a file deleted from the source, When passes run until just before 30 days after it was found gone, Then its copy is still in the backup', async () => {
  await put('a/0', 'kept for the live file')
  await put('a/1', 'deleted by mistake')
  await runBackup(env, FIRST)
  await source.delete('a/1')
  const found = at(27)
  await runBackup(env, found)
  expect(await goneAtOf('a/1')).toBe(found)

  // 29 days after, and exactly 30 days after: still kept.
  await runBackup(env, found + 29 * DAY)
  expect(await keysOf(backup)).toEqual(['a/0', 'a/1'])
  const summary = await runBackup(env, found + RETENTION_SECONDS)
  expect(summary.expired).toBe(0)
  expect(await keysOf(backup)).toEqual(['a/0', 'a/1'])
})

test('F39-AC28: Given a copy kept for 30 days, When a pass runs after the 31st day, Then the copy and its row are deleted, and the copy of a file the source still has stays', async () => {
  await put('a/0', 'live')
  await put('a/1', 'deleted')
  await runBackup(env, FIRST)
  await source.delete('a/1')
  const found = at(27)
  await runBackup(env, found)

  const summary = await runBackup(env, found + 31 * DAY)
  expect(summary).toMatchObject({ copied: 0, failed: 0, expired: 1 })
  expect(await keysOf(backup)).toEqual(['a/0'])
  expect(await goneAtOf('a/1')).toBeUndefined()
  // The live file's copy is 35 days old and is not touched.
  await runBackup(env, found + 35 * DAY)
  expect(await keysOf(backup)).toEqual(['a/0'])
  expect(await goneAtOf('a/0')).toBeNull()
})

test('F39-AC28: Given a copy whose source came back with the same content before the 30 days passed, When the pass after them runs, Then the copy stays', async () => {
  await put('a/0', 'same')
  await runBackup(env, FIRST)
  await source.delete('a/0')
  const found = at(27)
  await runBackup(env, found)
  await put('a/0', 'same')
  await runBackup(env, found + 31 * DAY)
  expect(await keysOf(backup)).toEqual(['a/0'])
  expect(await goneAtOf('a/0')).toBeNull()
})

test('F39-AC28: Given more expired copies than a run deletes, When the runs follow, Then they all go, a few at a time', async () => {
  for (const key of ['a/0', 'a/1', 'a/2']) await put(key, key)
  await runBackup(env, FIRST)
  for (const key of ['a/0', 'a/1', 'a/2']) await source.delete(key)
  const found = at(27)
  await runBackup(env, found)
  const late = found + 31 * DAY
  expect((await runBackup(env, late, { expireBatch: 2 })).expired).toBe(2)
  expect(await keysOf(backup)).toHaveLength(1)
  // An hourly run of the pass in progress is not what expires them: the
  // next pass is, a day later.
  expect((await runBackup(env, late + DAY, { expireBatch: 2 })).expired).toBe(1)
  expect(await keysOf(backup)).toEqual([])
})

test('F39-AC28: Given a backup bucket that cannot delete, When an expired copy is due, Then its row stays and the next run deletes it', async () => {
  await put('a/0', 'x')
  await runBackup(env, FIRST)
  await source.delete('a/0')
  const found = at(27)
  await runBackup(env, found)
  const down = envOf({ UPLOADS_BACKUP: failing(backup, 'delete', () => true) })
  const notify = vi.fn(async () => {})
  const late = found + 31 * DAY
  const first = await runBackup(down, late, { notify })
  expect(first).toMatchObject({ expired: 0, failed: 1 })
  expect(await goneAtOf('a/0')).toBe(found)
  expect(await keysOf(backup)).toEqual(['a/0'])
  expect(await runBackup(env, late + DAY)).toMatchObject({ expired: 1 })
  expect(await keysOf(backup)).toEqual([])
})

test('F39-AC31: Given a backup bucket that fails, When the run ends, Then one notice for the next day goes out, with the failed count and the steps of the backup', async () => {
  for (const key of ['a/0', 'a/1', 'a/2']) await put(key, key)
  const notify = vi.fn(async () => {})
  const down = envOf({ UPLOADS_BACKUP: failing(backup, 'put', () => true) })
  const summary = await runBackup(down, FIRST, { notify })
  expect(summary).toMatchObject({ copied: 0, failed: 3 })
  expect(notify).toHaveBeenCalledTimes(1)
  expect(notify).toHaveBeenCalledWith({
    kind: 'backup_failed',
    urgency: 'next_day',
    count: 3,
    link: 'docs/dev/alerts-runbook.md#backup-failed',
  })
})

test('F39-AC31: Given a run that fails nothing, When it ends, Then nothing is told', async () => {
  await put('a/0', 'x')
  const notify = vi.fn(async () => {})
  await runBackup(env, FIRST, { notify })
  expect(notify).not.toHaveBeenCalled()
})

test('F39-AC31: Given a failure that goes on, When hourly runs fail within 20 hours, Then it is told once, and again after the 20 hours', async () => {
  // Five failures give up the page, so the pass stays in progress.
  for (const key of ['a/0', 'a/1', 'a/2', 'a/3', 'a/4']) await put(key, key)
  const notify = vi.fn(async () => {})
  const down = envOf({ UPLOADS_BACKUP: failing(backup, 'put', () => true) })
  await runBackup(down, FIRST, { notify })
  expect((await readState(DB)).pass.kind).toBe('in_progress')
  await runBackup(down, at(26, 19), { notify })
  await runBackup(down, at(26, 20), { notify })
  expect(notify).toHaveBeenCalledTimes(1)
  await runBackup(down, at(27, 15), { notify })
  expect(notify).toHaveBeenCalledTimes(2)
})

test('F39-AC31: Given the source whose listing fails, When the run ends, Then the error is told as one failure, and its message is not logged', async () => {
  await put('a/0', 'x')
  const lines: unknown[] = []
  vi.spyOn(console, 'error').mockImplementation((line) => lines.push(line))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const broken = new Proxy(source, {
    get(target, name) {
      if (name === 'list')
        return () => Promise.reject(new Error('secret detail user@example.com'))
      const value = Reflect.get(target, name)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const notify = vi.fn(async () => {})
  await runBackup(envOf({ UPLOADS: broken }), FIRST, { notify })
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'backup_failed', count: 1 }),
  )
  expect(lines).toEqual([
    JSON.stringify({ event: 'backup_error', name: 'Error' }),
  ])
  vi.restoreAllMocks()
})

test('F39-AC31: Given a pass in progress that has not moved on for 3 days, When a run moves nothing, Then the days are told', async () => {
  await put('a/0', 'x')
  await db
    .update(backupState)
    .set({
      pass_started_at: FIRST - 3 * DAY,
      last_pass_started_at: FIRST - 3 * DAY,
      progress_at: FIRST - 3 * DAY,
    })
    .where(eq(backupState.id, 1))
  const notify = vi.fn(async () => {})
  // A budget that pays for the deletion of expired copies and no page.
  const summary = await runBackup(env, FIRST, { notify, budget: EXPIRE_COST })
  expect(summary).toMatchObject({ copied: 0, failed: 0 })
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'backup_failed', count: 3 }),
  )
})

test('F39-AC31: Given a pass that does move on, When the days since the last move are many, Then nothing is told', async () => {
  await put('a/0', 'x')
  await db
    .update(backupState)
    .set({
      pass_started_at: FIRST - 3 * DAY,
      last_pass_started_at: FIRST - 3 * DAY,
      progress_at: FIRST - 3 * DAY,
    })
    .where(eq(backupState.id, 1))
  const notify = vi.fn(async () => {})
  await runBackup(env, FIRST, { notify, budget: pageCost(1) + EXPIRE_COST })
  expect(notify).not.toHaveBeenCalled()
})

test('F39-AC31: Given a failed run and the real notifier, When the next day mail runs, Then the one mail says the backup failed and holds no address', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await put('a/0', 'x')
  const mailEnv = envOf({
    MAIL_OUTBOX: 'on',
    OPERATOR_ORIGIN: 'https://admin.slide.example',
    ALERT_MAIL_TO: 'ops@mail.example',
    UPLOADS_BACKUP: failing(backup, 'put', () => true),
  })
  await runBackup(mailEnv, FIRST, {
    notify: notifierOf(mailEnv, { clock: () => FIRST * 1000 }),
  })
  const next = Date.UTC(2026, 10, 26, 23, 17) / 1000
  expect(await sendDigest(mailEnv, next)).toEqual({ rows: 1, sent: true })
  const [mail] = await readOutbox(DB, 'ops@mail.example')
  expect(mail!.body).toContain('バックアップに失敗しました: 1 回')
  expect(mail!.body).toContain('docs/dev/alerts-runbook.md#backup-failed')
  expect(mail!.body).not.toContain('a/0')
  vi.restoreAllMocks()
})
