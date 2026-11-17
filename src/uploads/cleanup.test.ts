import { expect, test } from 'vitest'
import {
  describeCleanupError,
  sweepSchedule,
  sweepTargetSchema,
} from './cleanup'

test('Given a run at a time and a grace period, When its schedule is made, Then the instants are offset from that time alone', () => {
  expect(sweepSchedule(1_000_000, 3600)).toEqual({
    settledBefore: 1_000_000 - 3600,
    resweepBefore: 1_000_000 - 7 * 24 * 60 * 60,
    retryAt: 1_000_000 + 6 * 60 * 60,
  })
})

test('Given no grace period, When the schedule is made, Then deployments settle at the run time itself', () => {
  expect(sweepSchedule(50, 0).settledBefore).toBe(50)
})

test.each([
  ['an Error', new RangeError('boom'), { name: 'RangeError', message: 'boom' }],
  ['a string', 'boom', { name: 'unknown' }],
  ['null', null, { name: 'unknown' }],
])(
  'Given %s was thrown, When described, Then only loggable fields remain',
  (_case, error, expected) => {
    expect(describeCleanupError(error)).toEqual(expected)
  },
)

test('Given a very long message, When described, Then it is cut to 200 characters', () => {
  const described = describeCleanupError(new Error('x'.repeat(500)))
  expect(described).toEqual({ name: 'Error', message: 'x'.repeat(200) })
})

test.each([
  ['ready', true],
  ['failed', true],
  ['expired', true],
  ['uploading', false],
  ['deleted', false],
])(
  'Given a row in state %s, When parsed as a sweep target, Then it is accepted: %s',
  (state, accepted) => {
    expect(sweepTargetSchema.safeParse({ id: 'a', state }).success).toBe(
      accepted,
    )
  },
)
