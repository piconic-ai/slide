import { expect, test } from 'vitest'
import {
  BUSY_START,
  MAX_ATTEMPTS,
  busyStartWait,
  parseRetryDelay,
  scaledBusyStart,
  transientWait,
} from './retry-policy.mjs'

test('the retry delay defaults to one second and accepts a positive number', () => {
  expect(parseRetryDelay(undefined)).toBe(1000)
  expect(parseRetryDelay('')).toBe(1000)
  expect(parseRetryDelay('10')).toBe(10)
  expect(parseRetryDelay('0.5')).toBe(0.5)
})

test.each(['abc', '0', '-1', 'Infinity', 'NaN', ' '])(
  'a retry delay of %j is refused so the waits cannot loop or vanish',
  (value) => {
    expect(() => parseRetryDelay(value)).toThrow(
      'SLIDE_RETRY_DELAY_MS must be a positive number',
    )
  },
)

test('the busy-start policy scales with the retry delay', () => {
  // Given a 10 ms delay, a hundredth of the default
  // Then every limit shrinks by the same factor
  expect(scaledBusyStart(10)).toEqual({
    budgetMs: 3000,
    firstWaitMs: 50,
    maxWaitMs: 300,
  })
  expect(scaledBusyStart(1000)).toEqual(BUSY_START)
})

test('a transient failure waits longer on each try and stops at the attempt limit', () => {
  // Given a 1 s base delay and no Retry-After
  const wait = (attempt) =>
    transientWait({ attempt, retryAfter: null, baseMs: 1000 })
  // Then waits grow linearly until the last attempt, which stops
  expect([1, 2, 3, 4].map(wait)).toEqual([1000, 2000, 3000, 4000])
  expect(wait(MAX_ATTEMPTS)).toBeNull()
})

test('a transient failure follows Retry-After, including zero', () => {
  // Given the service asks for a specific wait, Then that wait is used
  expect(transientWait({ attempt: 1, retryAfter: 7000, baseMs: 1000 })).toBe(
    7000,
  )
  expect(transientWait({ attempt: 1, retryAfter: 0, baseMs: 1000 })).toBe(0)
})

test('a busy start doubles its wait up to the cap', () => {
  // Given no jitter
  const wait = (attempt) =>
    busyStartWait({ attempt, elapsedMs: 0, retryAfter: null, random: 0 })
  // Then waits double from 5 s and stop growing at 30 s
  expect([1, 2, 3, 4, 5].map(wait)).toEqual([5000, 10000, 20000, 30000, 30000])
})

test('jitter keeps a busy start wait between half and all of the backoff', () => {
  // Given the first busy start, When the random draw varies
  // Then the wait stays within 2.5 s to 5 s
  const wait = (random) =>
    busyStartWait({ attempt: 1, elapsedMs: 0, retryAfter: null, random })
  expect(wait(0)).toBe(5000)
  expect(wait(0.5)).toBe(3750)
  expect(wait(0.999)).toBeGreaterThanOrEqual(2500)
})

test('a busy start follows Retry-After instead of its own backoff', () => {
  // Given a late attempt whose backoff would be 30 s and a 1 s Retry-After
  // Then the service's wait is used
  expect(
    busyStartWait({ attempt: 6, elapsedMs: 0, retryAfter: 1000, random: 0 }),
  ).toBe(1000)
})

test('a busy start stops when the next wait would pass the budget', () => {
  const at = (elapsedMs) =>
    busyStartWait({ attempt: 9, elapsedMs, retryAfter: null, random: 0 })
  // Given the capped 30 s wait and the 300 s budget
  // Then a wait that ends exactly at the budget is allowed, one past it is not
  expect(at(BUSY_START.budgetMs - 30_000)).toBe(30_000)
  expect(at(BUSY_START.budgetMs - 29_999)).toBeNull()
  // And a Retry-After past the budget also stops
  expect(
    busyStartWait({
      attempt: 1,
      elapsedMs: 250_000,
      retryAfter: 120_000,
      random: 0,
    }),
  ).toBeNull()
})

test('a busy start polls well beyond the transient attempt limit', () => {
  // Given the jitter that waits the longest
  let elapsedMs = 0
  let tries = 0
  for (let attempt = 1; ; attempt++) {
    const wait = busyStartWait({
      attempt,
      elapsedMs,
      retryAfter: null,
      random: 0,
    })
    if (wait === null) break
    elapsedMs += wait
    tries++
  }
  // Then it keeps waiting for minutes, not the old ten seconds
  expect(tries).toBeGreaterThan(MAX_ATTEMPTS)
  expect(elapsedMs).toBeGreaterThan(240_000)
  expect(elapsedMs).toBeLessThanOrEqual(BUSY_START.budgetMs)
})
