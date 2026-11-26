import { expect, test } from 'vitest'
import {
  dailyTask,
  dueTasks,
  hourlyTask,
  isDue,
  registerTasks,
} from './cron-task'

const ok = async () => ({})
const at = (hour: number, minute = 17) => Date.UTC(2026, 10, 26, hour, minute)

test('Given an hourly task, When any firing of the day comes, Then it is due', () => {
  for (let hour = 0; hour < 24; hour++)
    expect(isDue({ kind: 'hourly' }, at(hour))).toBe(true)
})

test.each([0, 3, 12, 23])(
  'Given a daily task at %s UTC, When the 24 firings of a day come, Then it is due at exactly one, the one in its hour',
  (hour) => {
    const due = Array.from({ length: 24 }, (_, h) => h).filter((h) =>
      isDue({ kind: 'daily', hourUtc: hour }, at(h)),
    )
    expect(due).toEqual([hour])
  },
)

test('Given a daily task, When the firing is on the edge of its hour, Then the edge belongs to the hour it starts', () => {
  const schedule = { kind: 'daily', hourUtc: 5 } as const
  expect(isDue(schedule, Date.UTC(2026, 10, 26, 4, 59, 59, 999))).toBe(false)
  expect(isDue(schedule, Date.UTC(2026, 10, 26, 5, 0, 0, 0))).toBe(true)
  expect(isDue(schedule, Date.UTC(2026, 10, 26, 5, 59, 59, 999))).toBe(true)
  expect(isDue(schedule, Date.UTC(2026, 10, 26, 6, 0, 0, 0))).toBe(false)
})

test('Given a daily task, When the firing is at the turn of the day, the month or the year, Then the hour still decides', () => {
  const schedule = { kind: 'daily', hourUtc: 0 } as const
  expect(isDue(schedule, Date.UTC(2026, 11, 31, 23, 17))).toBe(false)
  expect(isDue(schedule, Date.UTC(2027, 0, 1, 0, 17))).toBe(true)
  expect(isDue(schedule, Date.UTC(2028, 1, 29, 0, 17))).toBe(true)
})

test.each([-1, 24, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'Given the hour %s, When a daily task is made, Then it is refused',
  (hour) => {
    expect(() => dailyTask('backup', hour, ok)).toThrow(RangeError)
  },
)

test.each([
  '',
  'Backup',
  'a-b',
  'a b',
  '_a',
  'a_',
  'a__b',
  '1a',
  'ばっくあっぷ',
])('Given the name "%s", When a task is made, Then it is refused', (name) => {
  expect(() => hourlyTask(name, ok)).toThrow(RangeError)
})

test('Given a task with no options, When made, Then it logs its name on success and name_error on failure, and only the error name', () => {
  const task = hourlyTask('signup_sweep', ok)
  expect(task.logs).toEqual({
    done: 'signup_sweep',
    failed: 'signup_sweep_error',
  })
  expect(task.errorFields(new TypeError('secret detail'))).toEqual({
    name: 'TypeError',
  })
  expect(task.errorFields('not an error')).toEqual({ name: 'unknown' })
})

test('Given a task that logs nothing on success, When made, Then it has no success event but keeps its failure event', () => {
  expect(hourlyTask('preview_sweep', ok, { logsSuccess: false }).logs).toEqual({
    done: null,
    failed: 'preview_sweep_error',
  })
})

test('Given tasks of both kinds, When a firing at 18 UTC comes, Then the hourly ones and the 18 o’clock one are due, in the order listed', () => {
  const tasks = [
    hourlyTask('a_first', ok),
    dailyTask('b_backup', 18, ok),
    dailyTask('c_metrics', 20, ok),
    hourlyTask('d_last', ok),
  ]
  expect(dueTasks(tasks, at(18)).map((task) => task.name)).toEqual([
    'a_first',
    'b_backup',
    'd_last',
  ])
  expect(dueTasks(tasks, at(19)).map((task) => task.name)).toEqual([
    'a_first',
    'd_last',
  ])
  expect(dueTasks([], at(18))).toEqual([])
})

test('Given two tasks with one name, When registered, Then it is refused', () => {
  expect(() =>
    registerTasks([hourlyTask('same', ok), dailyTask('same', 3, ok)]),
  ).toThrow(RangeError)
  expect(registerTasks([])).toEqual([])
})
