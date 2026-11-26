import { expect, test } from 'vitest'
import { expiryCutoff, RETENTION_SECONDS, TELL_AGAIN_SECONDS } from './limits'
import {
  parseState,
  stalledDays,
  tellCount,
  type BackupStateRow,
} from './run-plan'

const DAY = 24 * 60 * 60
const T = Date.UTC(2026, 10, 26, 18, 17) / 1000
const state = (changes: Partial<BackupStateRow> = {}) =>
  parseState({
    pass_started_at: null,
    cursor: null,
    last_pass_started_at: T - DAY,
    last_completed_at: T - DAY,
    progress_at: T - DAY,
    last_run_at: T - DAY,
    last_run_failed: 0,
    last_failed_at: null,
    told_at: null,
    ...changes,
  })

test('F39-AC28: Given a copy whose source was found gone, When the cutoff is taken, Then only a source gone for strictly more than 30 days is before it', () => {
  const goneAt = T
  const cutoff = (at: number) => expiryCutoff(at)
  // Exactly 30 days later it is not yet past; a second later it is.
  expect(goneAt < cutoff(goneAt + RETENTION_SECONDS)).toBe(false)
  expect(goneAt < cutoff(goneAt + RETENTION_SECONDS + 1)).toBe(true)
  expect(goneAt < cutoff(goneAt + 29 * DAY)).toBe(false)
})

test('F39-AC31: Given a run that failed some objects, When it is told, Then the count is how many failed', () => {
  expect(tellCount({ failed: 5, advanced: false }, state(), T)).toBe(5)
  expect(tellCount({ failed: 1, advanced: true }, state(), T)).toBe(1)
})

test('F39-AC31: Given a run that failed nothing and moved on, When it is told, Then nothing is told', () => {
  expect(tellCount({ failed: 0, advanced: true }, state(), T)).toBeNull()
})

test('F39-AC31: Given a failure told 19 hours ago, When another run fails, Then it is not told again, and after 20 hours it is', () => {
  const told = state({ told_at: T - TELL_AGAIN_SECONDS + 3600 })
  expect(tellCount({ failed: 2, advanced: false }, told, T)).toBeNull()
  const old = state({ told_at: T - TELL_AGAIN_SECONDS })
  expect(tellCount({ failed: 2, advanced: false }, old, T)).toBe(2)
})

test('F39-AC31: Given a pass that has not moved on for 2 days, When a run moves nothing and fails nothing, Then the days are told', () => {
  const stuck = state({ progress_at: T - 2 * DAY - 5 })
  expect(stalledDays(stuck, T)).toBe(2)
  expect(tellCount({ failed: 0, advanced: false }, stuck, T)).toBe(2)
})

test('F39-AC31: Given a pass that moved on a day and a half ago, When a run moves nothing, Then it has not stalled', () => {
  const recent = state({ progress_at: T - DAY - DAY / 2 })
  expect(stalledDays(recent, T)).toBe(0)
  expect(tellCount({ failed: 0, advanced: false }, recent, T)).toBeNull()
})

test('F39-AC31: Given a stalled pass, When a run moves it on, Then it is not told as stalled', () => {
  const stuck = state({ progress_at: T - 3 * DAY })
  expect(tellCount({ failed: 0, advanced: true }, stuck, T)).toBeNull()
})

test('F39-AC31: Given a service that never ran the backup, When a run fails nothing, Then there is no stall to tell', () => {
  const fresh = state({
    last_pass_started_at: null,
    last_completed_at: null,
    progress_at: null,
    last_run_at: null,
  })
  expect(stalledDays(fresh, T)).toBe(0)
})

test('F39-AC31: Given a first pass that never moved on, When 2 days pass, Then the days run from its start', () => {
  const first = state({
    last_pass_started_at: T - 2 * DAY,
    last_completed_at: null,
    progress_at: null,
    pass_started_at: T - 2 * DAY,
  })
  expect(stalledDays(first, T)).toBe(2)
})
