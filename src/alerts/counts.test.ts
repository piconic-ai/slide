import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from '../db/test-migrations'
import { alerts, alertSignals, lumaFeeds, reports } from '../db/schema'
import { seedDeck } from '../publication/test-support'
import { listQueued } from './alert-store'
import {
  countReportsSince,
  countStoppedFeedsSince,
  measureD1Size,
} from './count-store'
import { collectDaily, measureD1 } from './daily-routes'
import { countSignals, recordSignal, SIGNAL_KEEP_SECONDS } from './signal-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const DAY = 86400
const NOW = Date.UTC(2026, 10, 26, 22, 17) / 1000

beforeAll(async () => {
  await applyMigrations(database)
  await seedDeck(database, 'talk')
})
beforeEach(async () => {
  await db.delete(alerts)
  await db.delete(alertSignals)
  await db.delete(reports)
  await db.delete(lumaFeeds)
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => platform.dispose())

const envOf = (extra: Partial<Env> = {}) =>
  ({ ...platform.env, ...extra }) as Env

const report = (n: number, createdAt: number) => ({
  id: `report-${n}`,
  deck_id: 'talk',
  deployment_id: 'v1',
  share_path: '/@owner/talk',
  reason: 'nuisance' as const,
  note: 'n',
  reporter_user_id: `reader-${n}`,
  created_at: createdAt,
  updated_at: createdAt,
})
const stopped = (n: number, at: number | null) => ({
  url: `https://api.lu.ma/ics/get?entity=calendar&id=cal-${n}`,
  stopped_at: at,
  last_failure: at === null ? null : ('network' as const),
})

test('F39-AC4: Given reports made over two days, When the reports of the last day are counted, Then only those from its start are', async () => {
  await db
    .insert(reports)
    .values([
      report(1, NOW - DAY - 1),
      report(2, NOW - DAY),
      report(3, NOW - 10),
    ])
  expect(await countReportsSince(database, NOW - DAY)).toBe(2)
  expect(await countReportsSince(database, NOW + 1)).toBe(0)
})

test('F39-AC5: Given feeds stopped on different days and one not stopped, When the stopped ones of the last day are counted, Then only those from its start are', async () => {
  await db
    .insert(lumaFeeds)
    .values([
      stopped(1, NOW - 2 * DAY),
      stopped(2, NOW - 100),
      stopped(3, NOW - DAY),
      stopped(4, null),
    ])
  expect(await countStoppedFeedsSince(database, NOW - DAY)).toBe(2)
})

test('F39-AC4: Given a report in the day, When the day is collected, Then one alert holds the count for the next-day mail and no other', async () => {
  await db.insert(reports).values([report(1, NOW - 100), report(2, NOW - 50)])
  const told: unknown[] = []
  const summary = await collectDaily(
    envOf(),
    NOW,
    async (notice) => void told.push(notice),
  )
  expect(summary).toEqual({ reports: 2, stoppedFeeds: 0 })
  expect(told).toEqual([
    { kind: 'report_received', urgency: 'next_day', count: 2, link: '/' },
  ])
})

test('F39-AC5: Given a feed stopped in the day, When the day is collected and the alerts are queued, Then the queue holds one luma_feed_stopped row', async () => {
  await db.insert(lumaFeeds).values(stopped(1, NOW - 100))
  await collectDaily(envOf(), NOW)
  expect((await listQueued(database)).map((a) => [a.kind, a.count])).toEqual([
    ['luma_feed_stopped', 1],
  ])
})

test('F39-AC7: Given a quiet day, When the day is collected, Then nothing is queued', async () => {
  const told = vi.fn(async () => {})
  expect(await collectDaily(envOf(), NOW, told)).toEqual({
    reports: 0,
    stoppedFeeds: 0,
  })
  expect(told).not.toHaveBeenCalled()
})

test('F39-AC18: Given D1, When its size is measured, Then it is a number of bytes above zero', async () => {
  const bytes = await measureD1Size(database)
  expect(Number.isInteger(bytes)).toBe(true)
  expect(bytes).toBeGreaterThan(0)
})

test.each([
  ['absent', undefined],
  ['negative', -1],
  ['NaN', Number.NaN],
  ['a string', '4096'],
])(
  'F39-AC18: Given D1 that answers a size that is %s, When it is measured, Then it fails, so the failure is told, not hidden',
  async (_, size) => {
    const fake = {
      prepare: () => ({ run: async () => ({ meta: { size_after: size } }) }),
    } as unknown as D1Database
    await expect(measureD1Size(fake)).rejects.toThrow(
      'D1 did not report its size',
    )
  },
)

test('F39-AC18: Given D1 under the threshold, When the daily measure runs, Then the size is answered for the log and no alert is made', async () => {
  const told = vi.fn(async () => {})
  const { bytes } = await measureD1(envOf(), NOW, told)
  expect(bytes).toBeGreaterThan(0)
  expect(told).not.toHaveBeenCalled()
})

test('F39-AC6 and F39-AC16: Given a threshold of one byte, When the daily measure runs, Then a d1_size alert for the next day is queued with the size in megabytes', async () => {
  const env = envOf({ ALERT_THRESHOLDS: { d1SizeBytes: 1 } })
  const { bytes } = await measureD1(env, NOW)
  expect((await listQueued(database)).map((a) => [a.kind, a.count])).toEqual([
    ['d1_size', Math.ceil(bytes / 1_000_000)],
  ])
})

test('F39-AC1: Given failures noted at different times, When those within a window are counted, Then the older ones are not', async () => {
  for (const at of [NOW - 7200, NOW - 3599, NOW - 10, NOW])
    await recordSignal(database, 'login_mail_failed', at)
  await recordSignal(database, 'other_kind', NOW)
  expect(await countSignals(database, 'login_mail_failed', NOW - 3600)).toBe(3)
  expect(await countSignals(database, 'login_mail_failed', NOW + 1)).toBe(0)
  expect(await countSignals(database, 'never', 0)).toBe(0)
})

test('Given a signal more than a day old, When a new one is written, Then the old one is deleted', async () => {
  await recordSignal(
    database,
    'login_mail_failed',
    NOW - SIGNAL_KEEP_SECONDS - 1,
  )
  await recordSignal(database, 'login_mail_failed', NOW - SIGNAL_KEEP_SECONDS)
  await recordSignal(database, 'login_mail_failed', NOW)
  expect((await db.select().from(alertSignals)).map((r) => r.at)).toEqual([
    NOW - SIGNAL_KEEP_SECONDS,
    NOW,
  ])
})
