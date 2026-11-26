import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { backupObjects, backupState } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { ACCESS_TOKEN_HEADER } from '../operator/access'
import {
  accessTeam,
  AUDIENCE,
  OPERATOR_ORIGIN,
  TEAM,
} from '../operator/test-support'
import { testEnv } from '../publication/test-support'
import { runBackup, readBackupsFrame } from './backup-routes'
import { openBuckets } from './test-buckets'
import { eq } from 'drizzle-orm'

const team = await accessTeam()
// The keys come from the stand-in team instead of the network.
vi.mock('../operator/access-client', () => ({ accessKeys: () => team.keys }))

// The service's own database and bucket, with the backup bucket of the
// other configuration added to them.
const service = await getPlatformProxy<Env>({ persist: false })
const buckets = await openBuckets()
const database = service.env.DB
const db = drizzle(database)
beforeAll(() => applyMigrations(database))
beforeEach(async () => {
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
afterAll(async () => {
  await service.dispose()
  await buckets.dispose()
})

const envOf = (extra: Partial<Env> = {}) =>
  ({
    ...testEnv(service.env),
    CONTENT_ORIGIN: 'https://content.example',
    OPERATOR_ORIGIN,
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUDIENCE,
    ...extra,
  }) as unknown as Env

async function operations(env: Env) {
  const response = await server.fetch(
    new Request(`${OPERATOR_ORIGIN}/operations`, {
      headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
    }),
    env,
  )
  expect(response.status).toBe(200)
  return response.text()
}

/** The text of the frame "バックアップ": from its heading to the end of its section. */
const frameOf = (page: string) =>
  page.slice(
    page.indexOf('<section id="backups">'),
    page.indexOf('</section>', page.indexOf('<section id="backups">')),
  )

test('F39-AC30: Given no backup bucket, When the operations page is opened, Then the page opens and the backup frame says 未設定 with the binding to add and the steps', async () => {
  const page = await operations(envOf({ UPLOADS_BACKUP: undefined }))
  const frame = frameOf(page)
  expect(frame).toContain('未設定')
  expect(frame).toContain('UPLOADS_BACKUP')
  expect(frame).toContain('docs/dev/deploy.md#バックアップ作業-b')
  expect(page).toContain('<h2>通知</h2>')
})

test('F39-AC30: Given no backup bucket, When the task runs, Then nothing is written to the source or to D1', async () => {
  await service.env.UPLOADS.put('frame-test/0', 'x')
  const env = envOf({ UPLOADS_BACKUP: undefined })
  expect(await runBackup(env, Date.UTC(2026, 10, 26, 18, 17) / 1000)).toEqual({
    copied: 0,
    failed: 0,
    expired: 0,
  })
  expect(await db.select().from(backupObjects)).toEqual([])
  expect(await readBackupsFrame(env)).toEqual({ kind: 'not_configured' })
  await service.env.UPLOADS.delete('frame-test/0')
})

test('F39-AC32: Given a backup bucket and a run that copied files, When the operations page is opened, Then the frame shows when it last copied and how many', async () => {
  const env = envOf({ UPLOADS_BACKUP: buckets.env.UPLOADS_BACKUP })
  for (const key of ['frame-test/0', 'frame-test/1'])
    await service.env.UPLOADS.put(key, key)
  const at = Date.UTC(2026, 10, 26, 18, 17) / 1000
  const summary = await runBackup(env, at)
  expect(summary.failed).toBe(0)
  expect(summary.copied).toBeGreaterThanOrEqual(2)

  const frame = frameOf(await operations(env))
  expect(frame).not.toContain('未設定')
  expect(frame).toContain('2026-11-26T18:17:00.000Z')
  expect(frame).toContain(`${summary.copied} 件`)
  expect(frame).toMatch(/失敗<\/span>ありません<\/td>/)
  expect(frame).toContain('最後に終えたのは')
  await service.env.UPLOADS.delete(['frame-test/0', 'frame-test/1'])
})

test('F39-AC32: Given a run that failed, When the operations page is opened, Then the frame shows the failure and no key or address', async () => {
  const failingBackup = new Proxy(buckets.env.UPLOADS_BACKUP, {
    get(target, name) {
      if (name === 'put') return () => Promise.reject(new Error('down'))
      const value = Reflect.get(target, name)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  await service.env.UPLOADS.put('frame-test/secret-key', 'x')
  const env = envOf({ UPLOADS_BACKUP: failingBackup })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await runBackup(env, Date.UTC(2026, 10, 26, 18, 17) / 1000, {
    notify: async () => {},
  })
  vi.restoreAllMocks()
  const frame = frameOf(await operations(env))
  expect(frame).toContain('直近の実行で')
  expect(frame).not.toContain('frame-test/secret-key')
  await service.env.UPLOADS.delete('frame-test/secret-key')
})
