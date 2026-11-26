import { expect, test } from 'vitest'
import { parseState, planRun, type BackupStateRow } from './run-plan'

const row = (changes: Partial<BackupStateRow> = {}): BackupStateRow => ({
  pass_started_at: null,
  cursor: null,
  last_pass_started_at: null,
  last_completed_at: null,
  progress_at: null,
  last_run_at: null,
  last_run_failed: 0,
  last_failed_at: null,
  told_at: null,
  ...changes,
})

const utc = (day: number, hour: number, minute = 17) =>
  Date.UTC(2026, 10, day, hour, minute) / 1000

test('F39-AC29: Given a pass with a cursor, When the row is read, Then the state is a pass in progress at that cursor', () => {
  expect(
    parseState(
      row({ pass_started_at: 5, cursor: 'k', last_pass_started_at: 5 }),
    ).pass,
  ).toEqual({ kind: 'in_progress', startedAt: 5, cursor: 'k' })
})

test('F39-AC29: Given a pass that has no page yet, When the row is read, Then it is in progress with no cursor', () => {
  expect(parseState(row({ pass_started_at: 5 })).pass).toEqual({
    kind: 'in_progress',
    startedAt: 5,
    cursor: null,
  })
})

test('F39-AC29: Given a cursor without a pass, When the row is read, Then it is refused as a contradiction', () => {
  expect(() => parseState(row({ cursor: 'k' }))).toThrow(RangeError)
})

test('F39-AC25: Given a service that has never run the backup, When any firing comes, Then the first pass starts at once', () => {
  expect(planRun(parseState(row()), utc(26, 3))).toEqual({ kind: 'start' })
})

test('F39-AC25: Given a pass finished earlier today, When a firing of another hour comes, Then nothing is done', () => {
  const state = parseState(
    row({ last_pass_started_at: utc(26, 18), last_completed_at: utc(26, 18) }),
  )
  expect(planRun(state, utc(26, 19))).toEqual({ kind: 'idle' })
  expect(planRun(state, utc(27, 3))).toEqual({ kind: 'idle' })
})

test('F39-AC25: Given a pass finished yesterday, When the firing of hour 18 UTC comes, Then the next pass starts', () => {
  const state = parseState(
    row({ last_pass_started_at: utc(26, 18), last_completed_at: utc(26, 18) }),
  )
  expect(planRun(state, utc(27, 18))).toEqual({ kind: 'start' })
})

test('F39-AC26: Given a pass that started a minute ago, When a second firing falls in hour 18, Then no second pass starts', () => {
  const state = parseState(
    row({
      last_pass_started_at: utc(26, 18, 17),
      last_completed_at: utc(26, 18, 17),
    }),
  )
  expect(planRun(state, utc(26, 18, 50))).toEqual({ kind: 'idle' })
})

test('F39-AC29: Given a pass in progress, When a firing of any hour comes, Then it goes on from the cursor', () => {
  const state = parseState(
    row({
      pass_started_at: utc(26, 18),
      cursor: 'abc',
      last_pass_started_at: utc(26, 18),
    }),
  )
  expect(planRun(state, utc(26, 21))).toEqual({
    kind: 'continue',
    startedAt: utc(26, 18),
    cursor: 'abc',
  })
  expect(planRun(state, utc(27, 18))).toMatchObject({ kind: 'continue' })
})
