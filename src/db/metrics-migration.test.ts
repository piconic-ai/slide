import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { metricDaily, metricDays } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = drizzle(platform.env.DB)

const BEFORE = '0062_alert_signals.sql'
const METRICS = '0066_metric_daily.sql'

const existingState = async () =>
  db.all(sql`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE tbl_name NOT IN ('metric_daily', 'metric_days') ORDER BY type, name`)
let before: Awaited<ReturnType<typeof existingState>>

beforeAll(async () => {
  await applyMigrations(platform.env.DB, { until: BEFORE })
  before = await existingState()
  await applyMigrations(platform.env.DB, { after: BEFORE, until: METRICS })
}, 60_000)
afterAll(() => platform.dispose())

const line = (extra: Record<string, unknown> = {}) => ({
  day: '2026-11-25',
  event: 'deck_opened',
  detail: 'page',
  referrer: 'news.example',
  lang: 'ja' as const,
  screen: '',
  events: 3,
  value_sum: 0,
  ...extra,
})

test('F40-AC17: Given the tables before 0066, When the metrics tables are added, Then everything that was there is unchanged', async () => {
  expect(await existingState()).toEqual(before)
})

test('F40-AC15: Given migration 0066, When the columns of the daily table are listed, Then there is none that could hold an address, a person or a cookie', async () => {
  const columns = (
    await db.all<{ name: string }>(sql`PRAGMA table_info('metric_daily')`)
  ).map((column) => column.name)
  expect(columns).toEqual([
    'day',
    'event',
    'detail',
    'referrer',
    'lang',
    'screen',
    'events',
    'value_sum',
  ])
})

test('F40-AC17: Given a day of an event, When the same group is written twice, Then the database refuses the second, so a copy cannot double it', async () => {
  await db.insert(metricDaily).values(line())
  await expect(
    db.insert(metricDaily).values(line({ events: 5 })),
  ).rejects.toThrow()
  await db.insert(metricDaily).values(line({ detail: 'embed' }))
  expect(await db.select().from(metricDaily)).toHaveLength(2)
})

test.each([
  ['a day that is not a date shape', { day: '2026/11/25' }],
  ['a day with text after it', { day: '2026-11-25 x' }],
  ['an empty event', { event: '' }],
  ['an event of 41 characters', { event: 'x'.repeat(41) }],
  ['a detail of 201 characters', { detail: 'x'.repeat(201) }],
  ['a referrer of 254 characters', { referrer: 'x'.repeat(254) }],
  ['a language that is not ja, en or none', { lang: 'fr' }],
  ['a screen of 81 characters', { screen: 'x'.repeat(81) }],
  ['a negative count', { events: -1 }],
  ['a negative value', { value_sum: -0.5 }],
])(
  'F40-AC17: Given %s, When it is written, Then the database refuses it',
  async (_name, extra) => {
    await expect(
      db.run(sql`INSERT INTO metric_daily (day, event, detail, referrer, lang, screen, events, value_sum)
      VALUES (${String(line(extra).day)}, ${String(line(extra).event)}, ${String(line(extra).detail)},
        ${String(line(extra).referrer)}, ${String(line(extra).lang)}, ${String(line(extra).screen)},
        ${Number(line(extra).events)}, ${Number(line(extra).value_sum)})`),
    ).rejects.toThrow()
  },
)

test('F40-AC17: Given a copied day, When it is written, Then the day is kept once, with how many rows it had and whether it was cut', async () => {
  await db
    .insert(metricDays)
    .values({ day: '2026-11-25', copied_at: 1, row_count: 2, was_cut: 0 })
  await expect(
    db
      .insert(metricDays)
      .values({ day: '2026-11-25', copied_at: 2, row_count: 3, was_cut: 0 }),
  ).rejects.toThrow()
  await expect(
    db
      .insert(metricDays)
      .values({ day: '2026-11-26', copied_at: 1, row_count: 0, was_cut: 2 }),
  ).rejects.toThrow()
  await expect(
    db
      .insert(metricDays)
      .values({ day: '2026-11-26', copied_at: 1, row_count: -1, was_cut: 0 }),
  ).rejects.toThrow()
  await expect(
    db
      .insert(metricDays)
      .values({ day: 'yesterday', copied_at: 1, row_count: 0, was_cut: 0 }),
  ).rejects.toThrow()
})
