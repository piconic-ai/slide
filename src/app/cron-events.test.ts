import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from './routes'
import { applyMigrations } from '../db/test-migrations'
import { testEnv } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

/** Fires the Cron Trigger and returns the events logged, in order, and how many pieces of work it held the Worker for. */
async function fire(
  withEnv: Env,
  scheduledTime = Date.UTC(2026, 10, 26, 3, 17),
) {
  const events: { level: 'log' | 'error'; line: Record<string, unknown> }[] = []
  const record = (level: 'log' | 'error') => (text: unknown) =>
    events.push({ level, line: JSON.parse(String(text)) })
  vi.spyOn(console, 'log').mockImplementation(record('log'))
  vi.spyOn(console, 'error').mockImplementation(record('error'))
  const waited: Promise<unknown>[] = []
  try {
    await server.scheduled(
      { scheduledTime, cron: '17 * * * *', noRetry() {} },
      withEnv,
      {
        waitUntil: (promise: Promise<unknown>) => waited.push(promise),
        passThroughOnException() {},
        props: {},
      } as unknown as ExecutionContext,
    )
    await Promise.allSettled(waited)
  } finally {
    vi.restoreAllMocks()
  }
  return { events, waited: waited.length }
}

const eventsOf = (logged: Awaited<ReturnType<typeof fire>>['events']) =>
  logged.map(({ line }) => line.event)

test('Given the hourly Cron Trigger, When it fires, Then every task is started and each logs the event it always has', async () => {
  const { events, waited } = await fire(env)
  expect(waited).toBe(5)
  // The preview sweep logs nothing when it works; the others log a summary.
  expect(eventsOf(events).sort()).toEqual([
    'deck_purge',
    'feeds_read',
    'signup_sweep',
    'upload_cleanup',
  ])
  expect(events.every(({ level }) => level === 'log')).toBe(true)
})

test('Given the Trigger fires at any hour of the day, When it fires, Then the same tasks run', async () => {
  for (const hour of [0, 5, 12, 23]) {
    const { events, waited } = await fire(env, Date.UTC(2026, 10, 26, hour, 17))
    expect(waited).toBe(5)
    expect(eventsOf(events).sort()).toEqual([
      'deck_purge',
      'feeds_read',
      'signup_sweep',
      'upload_cleanup',
    ])
  }
})

test('Given every store fails, When the Trigger fires, Then each task that needs one logs its own error event with the fields it always had and none stops another', async () => {
  const { events, waited } = await fire({
    ...env,
    DB: undefined,
    UPLOADS: undefined,
  } as unknown as Env)
  expect(waited).toBe(5)
  const byEvent: Record<string, (typeof events)[number]> = {}
  for (const logged of events) byEvent[String(logged.line.event)] = logged
  expect(Object.keys(byEvent).sort()).toEqual([
    'deck_purge_error',
    'feeds_read',
    'preview_sweep_error',
    'signup_sweep_error',
    'upload_cleanup_error',
  ])
  // The feeds are read from a source outside D1, so they still report.
  expect(byEvent.feeds_read!.level).toBe('log')
  for (const [event, { level }] of Object.entries(byEvent))
    if (event !== 'feeds_read') expect(level).toBe('error')
  // These two carry the start of the message as well as the name.
  for (const event of ['upload_cleanup_error', 'deck_purge_error'])
    expect(Object.keys(byEvent[event]!.line).sort()).toEqual([
      'event',
      'message',
      'name',
    ])
  for (const event of ['preview_sweep_error', 'signup_sweep_error'])
    expect(Object.keys(byEvent[event]!.line).sort()).toEqual(['event', 'name'])
})

test('Given maintenance is on, When the Trigger fires, Then it logs that it skipped and starts nothing', async () => {
  const { events, waited } = await fire({
    ...env,
    MAINTENANCE: 'on',
  } as unknown as Env)
  expect(waited).toBe(0)
  expect(eventsOf(events)).toEqual(['scheduled_skipped_maintenance'])
})
