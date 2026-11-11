import { expect, test } from 'vitest'
import {
  BACKOFF_FACTOR,
  BACKOFF_TRIES,
  backoffSchedule,
  seconds,
  totalWaitMs,
} from './backoff'

test('Given factor 2 and 5 tries from 500ms, When scheduled, Then the waits are 0, 0.5, 1, 2, 4 seconds, 7.5 in total', () => {
  const steps = backoffSchedule(2, 5)
  expect(steps.map((step) => seconds(step.waitMs))).toEqual([
    '0s',
    '0.5s',
    '1s',
    '2s',
    '4s',
  ])
  expect(steps.map((step) => step.attempt)).toEqual([1, 2, 3, 4, 5])
  expect(seconds(totalWaitMs(steps))).toBe('7.5s')
})

test.each([
  [2, 1, ['0s'], '0s'],
  [1, 4, ['0s', '0.5s', '0.5s', '0.5s'], '1.5s'],
  [1.5, 4, ['0s', '0.5s', '0.75s', '1.13s'], '2.38s'],
  [2, 0, [], '0s'],
  [2, -1, [], '0s'],
  [2, 2.7, ['0s', '0.5s'], '0.5s'],
  [2, Infinity, [], '0s'],
  [2, Number.NaN, [], '0s'],
  [Number.NaN, 3, [], '0s'],
  [Infinity, 3, [], '0s'],
] as const)(
  'Given factor %d and %d tries, When scheduled, Then the waits are %j, %s in total',
  (factor, tries, waits, total) => {
    const steps = backoffSchedule(factor, tries)
    expect(steps.map((step) => seconds(step.waitMs))).toEqual(waits)
    expect(seconds(totalWaitMs(steps))).toBe(total)
  },
)

test('Given the largest slider values, When scheduled, Then the last wait is 500ms × 3^6', () => {
  const steps = backoffSchedule(BACKOFF_FACTOR.max, BACKOFF_TRIES.max)
  expect(steps).toHaveLength(8)
  expect(seconds(steps.at(-1)!.waitMs)).toBe('364.5s')
})

test('Given the sliders at rest, Then they start at factor 2 and 5 tries, as the slide does', () => {
  expect(BACKOFF_FACTOR.initial).toBe(2)
  expect(BACKOFF_TRIES.initial).toBe(5)
})

test('Given more tries than the slider allows, When scheduled, Then the list stops at the slider maximum', () => {
  expect(backoffSchedule(2, 1000)).toHaveLength(BACKOFF_TRIES.max)
})
