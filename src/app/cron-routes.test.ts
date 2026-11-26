import { afterEach, expect, test, vi } from 'vitest'
import { CRON_TASKS, runScheduled } from './cron-routes'
import { dailyTask, hourlyTask } from './cron-task'
import { describeCleanupError } from '../uploads/cleanup'
import type { Notice } from '../alerts/notice'
import type { Notifier } from '../alerts/notifier'

const lines = () => {
  const logged: { level: string; line: Record<string, unknown> }[] = []
  const record = (level: string) => (text: unknown) =>
    logged.push({ level, line: JSON.parse(String(text)) })
  vi.spyOn(console, 'log').mockImplementation(record('log'))
  vi.spyOn(console, 'error').mockImplementation(record('error'))
  return logged
}
afterEach(() => vi.restoreAllMocks())

async function fire(
  tasks: Parameters<typeof runScheduled>[0],
  hour: number,
  env: Record<string, string> = {},
  notify: Notifier = async () => {},
) {
  const waited: Promise<unknown>[] = []
  runScheduled(
    tasks,
    {
      scheduledTime: Date.UTC(2026, 10, 26, hour, 17),
      cron: '17 * * * *',
      noRetry() {},
    },
    env as unknown as Env,
    {
      waitUntil: (promise: Promise<unknown>) => waited.push(promise),
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext,
    notify,
  )
  await Promise.all(waited)
  return waited.length
}

test('Given the registered tasks, When listed, Then they are the five the service has always run, hourly, under their old names, and the three daily tasks of alerts', () => {
  expect(CRON_TASKS.map((task) => [task.name, task.schedule.kind])).toEqual([
    ['preview_sweep', 'hourly'],
    ['signup_sweep', 'hourly'],
    ['upload_cleanup', 'hourly'],
    ['deck_purge', 'hourly'],
    ['feeds_read', 'hourly'],
    ['d1_size', 'daily'],
    ['alert_collect', 'daily'],
    ['alert_digest', 'daily'],
  ])
  expect(CRON_TASKS.map((task) => task.logs)).toEqual([
    { done: null, failed: 'preview_sweep_error' },
    { done: 'signup_sweep', failed: 'signup_sweep_error' },
    { done: 'upload_cleanup', failed: 'upload_cleanup_error' },
    { done: 'deck_purge', failed: 'deck_purge_error' },
    { done: 'feeds_read', failed: 'feeds_read_error' },
    { done: 'd1_size', failed: 'd1_size_error' },
    { done: 'alert_collect', failed: 'alert_collect_error' },
    { done: 'alert_digest', failed: 'alert_digest_error' },
  ])
  const failure = new Error('x'.repeat(300))
  expect(CRON_TASKS[2]!.errorFields(failure)).toEqual(
    describeCleanupError(failure),
  )
  expect(CRON_TASKS[3]!.errorFields(failure)).toEqual(
    describeCleanupError(failure),
  )
  expect(CRON_TASKS[1]!.errorFields(failure)).toEqual({ name: 'Error' })
})

test('F39-AC18: Given the daily tasks of alerts, When their hours are read, Then the size of D1 is at 19, the day counted at 22 and the mail at 23 UTC, one hour each', () => {
  const hours = Object.fromEntries(
    CRON_TASKS.flatMap((task) =>
      task.schedule.kind === 'daily'
        ? [[task.name, task.schedule.hourUtc]]
        : [],
    ),
  )
  expect(hours).toEqual({ d1_size: 19, alert_collect: 22, alert_digest: 23 })
})

test('Given a daily task and an hourly one, When the firings of a day come, Then the daily one starts once and the hourly one every time', async () => {
  const hourly = vi.fn(async () => ({ n: 1 }))
  const daily = vi.fn(async () => ({ n: 2 }))
  const tasks = [hourlyTask('every', hourly), dailyTask('once', 18, daily)]
  lines()
  let started = 0
  for (let hour = 0; hour < 24; hour++) started += await fire(tasks, hour)
  expect(hourly).toHaveBeenCalledTimes(24)
  expect(daily).toHaveBeenCalledTimes(1)
  expect(started).toBe(25)
})

test('Given a task, When it runs, Then it gets the environment and the firing time in whole seconds', async () => {
  const run = vi.fn(async () => ({}))
  lines()
  const env = { PUBLIC_ORIGIN: 'https://x.example' }
  await fire([hourlyTask('probe', run)], 5, env)
  expect(run).toHaveBeenCalledWith(env, Date.UTC(2026, 10, 26, 5, 17) / 1000)
})

test('Given a task that works, When it runs, Then its summary is logged under its event', async () => {
  const logged = lines()
  await fire([hourlyTask('summed', async () => ({ read: 2, failed: 0 }))], 5)
  expect(logged).toEqual([
    { level: 'log', line: { event: 'summed', read: 2, failed: 0 } },
    {
      level: 'log',
      line: {
        event: 'cron_task',
        task: 'summed',
        outcome: 'ok',
        count: 2,
        ms: expect.any(Number),
      },
    },
  ])
})

test('Given a task with no success line or a summary that is not an object, When it works, Then it logs what is allowed', async () => {
  const logged = lines()
  await fire(
    [
      hourlyTask('quiet', async () => ({ n: 1 }), { logsSuccess: false }),
      hourlyTask('plain', async () => undefined),
      hourlyTask('nothing', async () => null),
    ],
    5,
  )
  // The old line a task has always written, and the new one every task writes.
  expect(
    logged.map(({ line }) => line).filter((line) => line.event !== 'cron_task'),
  ).toEqual([{ event: 'plain' }, { event: 'nothing' }])
  expect(
    logged
      .map(({ line }) => line)
      .filter((line) => line.event === 'cron_task')
      .map(({ task, outcome, count }) => [task, outcome, count]),
  ).toEqual([
    ['quiet', 'ok', 1],
    ['plain', 'ok', 0],
    ['nothing', 'ok', 0],
  ])
})

test('Given tasks that fail, When they run, Then each is logged by its own event, the fields its task allows, and the rest still run', async () => {
  const logged = lines()
  const after = vi.fn(async () => ({}))
  await fire(
    [
      hourlyTask('rejects', async () => {
        throw new TypeError('private detail')
      }),
      // Thrown before the first await.
      hourlyTask('throws_now', () => {
        throw new RangeError('private detail')
      }),
      hourlyTask('detailed', async () => Promise.reject(new Error('shown')), {
        errorFields: describeCleanupError,
      }),
      hourlyTask('not_an_error', async () => Promise.reject('text')),
      hourlyTask('after', after),
    ],
    5,
  )
  expect(after).toHaveBeenCalledTimes(1)
  const byEvent = Object.fromEntries(
    logged
      .filter(({ line }) => line.event !== 'cron_task')
      .map(({ level, line }) => [String(line.event), { level, line }]),
  )
  expect(byEvent.rejects).toBeUndefined()
  expect(byEvent.rejects_error).toEqual({
    level: 'error',
    line: { event: 'rejects_error', name: 'TypeError' },
  })
  expect(byEvent.throws_now_error?.line).toEqual({
    event: 'throws_now_error',
    name: 'RangeError',
  })
  expect(byEvent.detailed_error?.line).toEqual({
    event: 'detailed_error',
    name: 'Error',
    message: 'shown',
  })
  expect(byEvent.not_an_error?.line).toBeUndefined()
  expect(byEvent.not_an_error_error?.line).toEqual({
    event: 'not_an_error_error',
    name: 'unknown',
  })
  expect(JSON.stringify(logged)).not.toContain('private detail')
  expect(byEvent.after?.level).toBe('log')
})

test.each(['on'])(
  'Given maintenance is "%s", When the Trigger fires, Then nothing starts and the skip is logged',
  async (value) => {
    const logged = lines()
    const run = vi.fn(async () => ({}))
    expect(
      await fire([hourlyTask('never', run)], 5, { MAINTENANCE: value }),
    ).toBe(0)
    expect(run).not.toHaveBeenCalled()
    expect(logged.map(({ line }) => line)).toEqual([
      { event: 'scheduled_skipped_maintenance' },
    ])
  },
)

test('Given no tasks are due, When the Trigger fires, Then nothing starts and nothing is logged', async () => {
  const logged = lines()
  expect(await fire([dailyTask('later', 20, async () => ({}))], 5)).toBe(0)
  expect(logged).toEqual([])
})

test('F39-AC17: Given tasks that work and tasks that fail, When they run, Then each leaves one line of one shape: its name, ok or failed, how many it handled and how long it took', async () => {
  const logged = lines()
  await fire(
    [
      hourlyTask('sweeps', async () => 4),
      hourlyTask('reads', async () => ({
        read: 2,
        unchanged: 1,
        complete: true,
      })),
      hourlyTask('breaks', async () => {
        throw new Error('x')
      }),
    ],
    5,
  )
  const shaped = logged
    .map(({ line }) => line)
    .filter((line) => line.event === 'cron_task')
  expect(shaped).toHaveLength(3)
  for (const line of shaped)
    expect(Object.keys(line).sort()).toEqual(
      ['count', 'event', 'ms', 'outcome', 'task'].sort(),
    )
  expect(shaped.map((l) => [l.task, l.outcome, l.count])).toEqual([
    ['sweeps', 'ok', 4],
    ['reads', 'ok', 3],
    ['breaks', 'failed', 0],
  ])
  for (const line of shaped) expect(Number(line.ms)).toBeGreaterThanOrEqual(0)
})

test('F39-AC3: Given a task that fails, When it runs, Then it is told as an alert by its name, and the tasks that work are not', async () => {
  lines()
  const told: Notice[] = []
  const after = vi.fn(async () => ({}))
  await fire(
    [
      hourlyTask('breaks', async () => {
        throw new TypeError('private detail')
      }),
      hourlyTask('after', after),
    ],
    5,
    {},
    async (notice) => void told.push(notice),
  )
  expect(told).toEqual([
    {
      kind: 'cron_failed',
      urgency: 'next_day',
      count: 1,
      link: 'docs/dev/alerts-runbook.md#cron-failed',
      task: 'breaks',
    },
  ])
  expect(after).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(told)).not.toContain('private detail')
})

test('F39-AC3: Given a sender of alerts that rejects, When a task fails, Then the other tasks still run', async () => {
  lines()
  const after = vi.fn(async () => ({}))
  await fire(
    [
      hourlyTask('breaks', async () => {
        throw new Error('x')
      }),
      hourlyTask('after', after),
    ],
    5,
    {},
    async () => {
      throw new Error('sender down')
    },
  )
  expect(after).toHaveBeenCalledTimes(1)
})

test('F39-AC3: Given a task whose name no notice can carry, When it fails, Then the failure is logged and nothing throws', async () => {
  lines()
  const told = vi.fn(async () => {})
  const longName = `a${'b'.repeat(40)}`
  await fire(
    [
      hourlyTask(longName, async () => {
        throw new Error('x')
      }),
    ],
    5,
    {},
    told,
  )
  expect(told).not.toHaveBeenCalled()
})
