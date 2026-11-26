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
import { CRON_TASKS, runCronTask } from '../app/cron-routes'
import { applyMigrations } from '../db/test-migrations'
import { metricDaily, metricDays } from '../db/schema'
import { CopyFailedError, copyMetrics, copySettingsOf } from './daily-routes'
import { MAX_DAY_ROWS } from './day-query'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = drizzle(platform.env.DB)
const ACCOUNT = '0123456789abcdef0123456789abcdef'
const TOKEN = 'read-token-0123456789'
const AT = Date.parse('2026-11-26T20:17:00Z') / 1000

const settings = {
  ANALYTICS: { writeDataPoint() {} },
  ANALYTICS_READ_TOKEN: TOKEN,
  ANALYTICS_ACCOUNT_ID: ACCOUNT,
}
const envOf = (extra: object = {}) =>
  ({ ...platform.env, ...settings, ...extra }) as unknown as Env

beforeAll(() => applyMigrations(platform.env.DB), 60_000)
beforeEach(async () => {
  await db.delete(metricDaily)
  await db.delete(metricDays)
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => platform.dispose())

const row = (extra: Record<string, unknown> = {}) => ({
  event: 'deck_opened',
  detail: 'page',
  referrer: 'news.example',
  lang: 'ja',
  screen: '',
  events: 10,
  value_sum: 0,
  ...extra,
})

/** A stand-in for fetch: answers what `by` makes of the day asked for. */
function standIn(by: (day: string) => Response | unknown[]) {
  const asked: { day: string; init: RequestInit | undefined }[] = []
  const send = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const day =
      /toDateTime\('(\d{4}-\d{2}-\d{2}) 00:00:00'\)\s+AND/.exec(
        String(init?.body),
      )?.[1] ?? ''
    asked.push({ day, init })
    const made = by(day)
    return made instanceof Response
      ? made
      : new Response(JSON.stringify({ data: made }), { status: 200 })
  })
  return { send: send as unknown as typeof fetch, asked, calls: send }
}

const copied = async () =>
  (await db.select().from(metricDays)).map((d) => d.day).sort()

test('F40-AC17: Given the settings and nothing copied, When the copy runs, Then the last seven days are read and written, oldest first, and today is not', async () => {
  const { send, asked } = standIn(() => [row()])
  const summary = await copyMetrics(envOf(), AT, send)
  expect(summary).toEqual({ days: 7, rows: 7 })
  expect(asked.map((a) => a.day)).toEqual([
    '2026-11-19',
    '2026-11-20',
    '2026-11-21',
    '2026-11-22',
    '2026-11-23',
    '2026-11-24',
    '2026-11-25',
  ])
  expect(await copied()).toHaveLength(7)
  for (const { init } of asked)
    expect(init?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` })
})

test('F40-AC17: Given a day copied, When the same day is copied again, Then its counts are the same and not doubled', async () => {
  const first = standIn(() => [
    row({ events: 10 }),
    row({ detail: 'embed', events: 4 }),
  ])
  await copyMetrics(envOf(), AT, first.send)
  const before = await db.select().from(metricDaily)
  expect(before.filter((r) => r.day === '2026-11-25')).toHaveLength(2)

  // The seven days are copied, so a second run finds nothing left; copy the
  // last day again by taking its mark away, as a manual re-run would.
  await db.delete(metricDays)
  const again = standIn(() => [
    row({ events: 10 }),
    row({ detail: 'embed', events: 4 }),
  ])
  await copyMetrics(envOf(), AT, again.send)
  const after = await db.select().from(metricDaily)
  expect(after).toHaveLength(before.length)
  expect(
    after.find((r) => r.day === '2026-11-25' && r.detail === 'page')?.events,
  ).toBe(10)
  expect(after.reduce((sum, r) => sum + r.events, 0)).toBe(
    before.reduce((sum, r) => sum + r.events, 0),
  )
})

test('F40-AC17: Given a day copied, When it is copied again with other counts, Then the day holds the new counts only, with no row left from the old copy', async () => {
  const first = standIn((day) =>
    day === '2026-11-25'
      ? [
          row({ detail: 'page', events: 10 }),
          row({ detail: 'embed', events: 4 }),
        ]
      : [],
  )
  await copyMetrics(envOf(), AT, first.send)
  await db.delete(metricDays)
  const second = standIn((day) =>
    day === '2026-11-25' ? [row({ detail: 'page', events: 11 })] : [],
  )
  await copyMetrics(envOf(), AT, second.send)
  const day = (await db.select().from(metricDaily)).filter(
    (r) => r.day === '2026-11-25',
  )
  expect(day).toEqual([expect.objectContaining({ detail: 'page', events: 11 })])
})

test('F40-AC17: Given all seven days copied, When the copy runs again, Then the API is not asked at all', async () => {
  const first = standIn(() => [row()])
  await copyMetrics(envOf(), AT, first.send)
  const second = standIn(() => [row()])
  expect(await copyMetrics(envOf(), AT, second.send)).toEqual({
    days: 0,
    rows: 0,
  })
  expect(second.calls).not.toHaveBeenCalled()
})

test('F40-AC17: Given a day with no events, When it is copied, Then the day is marked copied with no rows, and is not asked for again', async () => {
  const { send } = standIn(() => [])
  expect(await copyMetrics(envOf(), AT, send)).toEqual({ days: 7, rows: 0 })
  expect(await db.select().from(metricDaily)).toEqual([])
  expect(await db.select().from(metricDays)).toHaveLength(7)
})

test('F40-AC17: Given the next day, When the copy runs, Then only the new day is read', async () => {
  await copyMetrics(envOf(), AT, standIn(() => [row()]).send)
  const next = standIn(() => [row()])
  await copyMetrics(envOf(), AT + 24 * 3600, next.send)
  expect(next.asked.map((a) => a.day)).toEqual(['2026-11-26'])
})

test('F40-AC17: Given one day the API fails on, When the copy runs, Then the other days are copied, the task fails after them, and the next copy takes the failed day', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const flaky = standIn((day) =>
    day === '2026-11-22' ? new Response('boom', { status: 500 }) : [row()],
  )
  await expect(copyMetrics(envOf(), AT, flaky.send)).rejects.toBeInstanceOf(
    CopyFailedError,
  )
  expect(await copied()).toEqual([
    '2026-11-19',
    '2026-11-20',
    '2026-11-21',
    '2026-11-23',
    '2026-11-24',
    '2026-11-25',
  ])
  const retry = standIn(() => [row()])
  expect(await copyMetrics(envOf(), AT, retry.send)).toEqual({
    days: 1,
    rows: 1,
  })
  expect(retry.asked.map((a) => a.day)).toEqual(['2026-11-22'])
})

test('F40-AC17: Given an answer of the wrong shape for one day, When the copy runs, Then nothing of that day is written and the others are', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const wrong = standIn((day) =>
    day === '2026-11-24' ? [row({ events: -3 })] : [row()],
  )
  await expect(copyMetrics(envOf(), AT, wrong.send)).rejects.toBeInstanceOf(
    CopyFailedError,
  )
  expect(
    (await db.select().from(metricDaily)).filter((r) => r.day === '2026-11-24'),
  ).toEqual([])
  expect(await copied()).not.toContain('2026-11-24')
})

test('F40-AC17: Given a failure, When it is logged, Then the day, the error’s name and the status are, and neither the token nor the answer’s text is', async () => {
  const lines: string[] = []
  vi.spyOn(console, 'error').mockImplementation((text: unknown) =>
    lines.push(String(text)),
  )
  await expect(
    copyMetrics(
      envOf(),
      AT,
      standIn(() => new Response(`bad ${TOKEN}`, { status: 403 })).send,
    ),
  ).rejects.toBeInstanceOf(CopyFailedError)
  expect(lines).toHaveLength(7)
  expect(JSON.parse(lines[0] ?? '')).toEqual({
    event: 'metrics_day_failed',
    day: '2026-11-19',
    name: 'AnalyticsApiError',
    status: 403,
  })
  expect(lines.join('')).not.toContain(TOKEN)
})

test('F40-AC17: Given a day with as many groups as a copy holds, When it is copied, Then it is marked as cut', async () => {
  const many = Array.from({ length: MAX_DAY_ROWS }, (_, i) =>
    row({ detail: `w${i}` }),
  )
  await copyMetrics(
    envOf(),
    AT,
    standIn((day) => (day === '2026-11-25' ? many : [])).send,
  )
  const days = await db.select().from(metricDays)
  expect(days.find((d) => d.day === '2026-11-25')).toMatchObject({
    row_count: MAX_DAY_ROWS,
    was_cut: 1,
  })
  expect(days.find((d) => d.day === '2026-11-24')?.was_cut).toBe(0)
})

test.each([
  ['no token', { ANALYTICS_READ_TOKEN: undefined }, ['ANALYTICS_READ_TOKEN']],
  ['an empty token', { ANALYTICS_READ_TOKEN: '  ' }, ['ANALYTICS_READ_TOKEN']],
  ['no account', { ANALYTICS_ACCOUNT_ID: undefined }, ['ANALYTICS_ACCOUNT_ID']],
  [
    'an account that is no account number',
    { ANALYTICS_ACCOUNT_ID: 'x/../y' },
    ['ANALYTICS_ACCOUNT_ID'],
  ],
  ['no dataset', { ANALYTICS: undefined }, ['ANALYTICS']],
  [
    'nothing at all',
    {
      ANALYTICS: undefined,
      ANALYTICS_READ_TOKEN: undefined,
      ANALYTICS_ACCOUNT_ID: undefined,
    },
    ['ANALYTICS', 'ANALYTICS_READ_TOKEN', 'ANALYTICS_ACCOUNT_ID'],
  ],
])(
  'F40-AC22, F40-AC23: Given %s, When the copy runs, Then nothing is asked or written, and the missing setting is named',
  async (_name, override, missing) => {
    const { send, calls } = standIn(() => [row()])
    const env = envOf(override)
    expect(await copyMetrics(env, AT, send)).toEqual({ days: 0, rows: 0 })
    expect(calls).not.toHaveBeenCalled()
    expect(await db.select().from(metricDays)).toEqual([])
    expect(copySettingsOf(env)).toEqual({ kind: 'not_configured', missing })
  },
)

test('F40-AC22, F40-AC23: Given all the settings, When they are read, Then they are ready, with the token and the account as set', () => {
  expect(copySettingsOf(envOf())).toEqual({
    kind: 'ready',
    accountId: ACCOUNT,
    token: TOKEN,
  })
})

test('F40-AC17, F40-AC23: Given the daily firing of the copy at 20 UTC, When the Cron Trigger runs the task without the settings, Then it logs a run that handled nothing and fails no alert', async () => {
  const task = CRON_TASKS.find(({ name }) => name === 'metrics_copy')
  expect(task?.schedule).toEqual({ kind: 'daily', hourUtc: 20 })
  const lines: Record<string, unknown>[] = []
  vi.spyOn(console, 'log').mockImplementation((text: unknown) =>
    lines.push(JSON.parse(String(text))),
  )
  const notify = vi.fn(async () => {})
  await runCronTask(
    task!,
    { ...platform.env, ANALYTICS_READ_TOKEN: undefined } as unknown as Env,
    AT,
    notify,
  )
  expect(lines.find((line) => line.event === 'cron_task')).toMatchObject({
    task: 'metrics_copy',
    outcome: 'ok',
    count: 0,
  })
  expect(notify).not.toHaveBeenCalled()
})

test('F40-AC17: Given a failure of the copy, When the Cron Trigger runs the task, Then it is a failed run and a cron_failed alert for the next day', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const task = CRON_TASKS.find(({ name }) => name === 'metrics_copy')!
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('x', { status: 500 })),
  )
  const notify = vi.fn(async () => {})
  try {
    await runCronTask(task, envOf(), AT, notify)
  } finally {
    vi.unstubAllGlobals()
  }
  expect(notify).toHaveBeenCalledTimes(1)
})
