import { describe, expect, test } from 'vitest'
import { OFFLINE_MAX_AGE_MS } from './limits'
import { isFresh, outcomeOf, type AnswerFacts } from './policy'

const answer = (facts: Partial<AnswerFacts>): AnswerFacts => ({
  status: 200,
  cacheControl: 'no-cache, no-transform',
  type: 'basic',
  redirected: false,
  ...facts,
})

describe('outcomeOf', () => {
  test.each([
    [200, 'store'],
    [404, 'purge'],
    [410, 'purge'],
    [403, 'purge'],
    [429, 'fallback'],
    [500, 'fallback'],
    [502, 'fallback'],
    [503, 'fallback'],
    [599, 'fallback'],
    [304, 'pass'],
    [301, 'pass'],
    [206, 'pass'],
    [204, 'pass'],
    [400, 'pass'],
    [401, 'pass'],
    [418, 'pass'],
    [0, 'pass'],
  ])(
    'F37-AC3: Given the service answers %i, When the worker decides, Then it %s',
    (status, expected) => {
      expect(outcomeOf(answer({ status }))).toBe(expected)
    },
  )

  test.each([
    'private, no-store, no-transform',
    'private',
    'no-store',
    'public, NO-STORE',
    'max-age=0, Private',
  ])(
    'Given an answer meant for one person or no disk (%s), Then it is passed on, not kept',
    (cacheControl) => {
      expect(outcomeOf(answer({ cacheControl }))).toBe('pass')
    },
  )

  test.each([
    null,
    '',
    'no-cache',
    'public, max-age=60',
    'no-cache, no-transform',
  ])('Given a public answer (%s), Then it is kept', (cacheControl) => {
    expect(outcomeOf(answer({ cacheControl }))).toBe('store')
  })

  test('Given a name that only contains the word, Then it is not taken for the directive', () => {
    expect(outcomeOf(answer({ cacheControl: 'x-private-thing=1' }))).toBe(
      'store',
    )
  })

  test.each(['opaque', 'cors', 'opaqueredirect', 'error'])(
    'Given an answer of type %s, Then it is not kept',
    (type) => {
      expect(outcomeOf(answer({ type }))).toBe('pass')
    },
  )

  test('Given a redirected 200, Then it is not kept', () => {
    expect(outcomeOf(answer({ redirected: true }))).toBe('pass')
  })

  test('Given a withdrawn status, Then it drops the copies even when the answer is of another type', () => {
    expect(
      outcomeOf(answer({ status: 404, type: 'cors', redirected: true })),
    ).toBe('purge')
  })
})

describe('isFresh', () => {
  const now = 1_700_000_000_000

  test.each([
    ['just now', now, true],
    ['an hour ago', now - 3_600_000, true],
    ['exactly one day ago', now - OFFLINE_MAX_AGE_MS, true],
    ['one millisecond over a day', now - OFFLINE_MAX_AGE_MS - 1, false],
    ['a week ago', now - 7 * OFFLINE_MAX_AGE_MS, false],
    ['in the future', now + 1, false],
    ['at the epoch', 0, false],
    ['not a number', Number.NaN, false],
    ['infinite', Number.POSITIVE_INFINITY, false],
    ['negative infinite', Number.NEGATIVE_INFINITY, false],
  ])(
    'F37-AC10: Given a copy fetched %s, Then it is shown: %s',
    (_, storedAt, shown) => {
      expect(isFresh(storedAt, now)).toBe(shown)
    },
  )
})
