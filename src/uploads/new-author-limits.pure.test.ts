import { describe, expect, test } from 'vitest'
import {
  decidePlacement,
  isNewAuthor,
  parseNewAuthorLimits,
  placementCapOf,
  placementWindowOf,
} from './new-author-limits'

const DAY = 86_400
const limits = parseNewAuthorLimits({})

describe('the setting', () => {
  test('F42-AC22: Given no setting, When the limits are read, Then a person is new for 7 days and may make 3 new slides a day', () => {
    expect(parseNewAuthorLimits(undefined)).toEqual({ days: 7, perDay: 3 })
  })
  test('F42-AC22: Given values in the setting, When the limits are read, Then they are used', () => {
    expect(parseNewAuthorLimits({ days: 14, perDay: 5 })).toEqual({
      days: 14,
      perDay: 5,
    })
    expect(parseNewAuthorLimits({ perDay: 1 })).toEqual({ days: 7, perDay: 1 })
  })
  test.each([
    { perDay: 0 },
    { perDay: -1 },
    { perDay: 1.5 },
    { days: '7' },
    { days: 0 },
    { extra: 1 },
    'text',
    42,
    null,
  ])(
    'F42-AC22: Given the mistaken setting %j, When the limits are read, Then the defaults apply and nothing is lifted',
    (input) => {
      expect(parseNewAuthorLimits(input)).toEqual({ days: 7, perDay: 3 })
    },
  )
})

describe('who is new', () => {
  const at = 1_000_000
  test.each([
    [at - 1, true],
    [at - 6 * DAY, true],
    [at - 7 * DAY + 1, true],
    [at - 7 * DAY, false],
    [at - 30 * DAY, false],
    [null, false],
  ])(
    'F42-AC21: Given an account made at %s, When it is judged at the same moment, Then it is new: %s',
    (registeredAt, expected) => {
      expect(isNewAuthor(registeredAt, at, limits)).toBe(expected)
    },
  )
  test('F42-AC22: Given 14 days in the setting, When someone registered 10 days ago is judged, Then they are new', () => {
    expect(
      isNewAuthor(at - 10 * DAY, at, parseNewAuthorLimits({ days: 14 })),
    ).toBe(true)
  })
})

describe('the window of a day', () => {
  test('F42-AC17: Given a moment, When the window is made, Then it is the 24 hours that end at it', () => {
    expect(placementWindowOf(1_000_000)).toEqual({
      since: 1_000_000 - DAY,
      until: 1_000_000,
      seconds: DAY,
    })
  })
  test('F42-AC21: Given someone who registered 8 days ago or has no account, When the cap is made, Then there is none', () => {
    expect(placementCapOf(1_000_000, 1_000_000 - 8 * DAY, limits)).toBeNull()
    expect(placementCapOf(1_000_000, null, limits)).toBeNull()
  })
  test('F42-AC22: Given a new person and a limit of 5, When the cap is made, Then it holds 5 in the window', () => {
    expect(
      placementCapOf(
        1_000_000,
        1_000_000 - DAY,
        parseNewAuthorLimits({ perDay: 5 }),
      ),
    ).toEqual({ window: placementWindowOf(1_000_000), perDay: 5 })
  })
})

describe('the decision', () => {
  const now = 1_000_000
  const recent = now - 3 * DAY
  const decide = (
    placedAt: number[],
    registeredAt: number | null = recent,
    given = limits,
  ) => decidePlacement(placementCapOf(now, registeredAt, given), placedAt)

  test('F42-AC17: Given fewer new slides than the limit in the window, When a new one is asked for, Then it is allowed', () => {
    expect(decide([])).toEqual({ kind: 'allowed' })
    expect(decide([now - 10, now - 20])).toEqual({ kind: 'allowed' })
  })
  test('F42-AC18: Given the limit reached in the window, When a new one is asked for, Then it is refused until the oldest leaves the window', () => {
    expect(decide([now - 10, now - 20, now - 30])).toEqual({
      kind: 'refused',
      availableAt: now - 30 + DAY,
    })
  })
  test('F42-AC18: Given more slides in the window than the limit (a lowered setting), When a new one is asked for, Then it opens when enough have left to go under the limit', () => {
    // Limit 3, five in the window: the 3rd newest must leave, not the oldest.
    expect(decide([now - 50, now - 40, now - 30, now - 20, now - 10])).toEqual({
      kind: 'refused',
      availableAt: now - 30 + DAY,
    })
    expect(decide([now - 40, now - 30, now - 20, now - 10])).toEqual({
      kind: 'refused',
      availableAt: now - 30 + DAY,
    })
  })
  test('F42-AC18: Given the answer of a refusal, When the moment it names arrives, Then a new slide is allowed', () => {
    const placed = [now - 100, now - 200, now - 300]
    const refused = decide(placed)
    expect(refused.kind).toBe('refused')
    if (refused.kind !== 'refused') return
    const later = refused.availableAt
    expect(
      decidePlacement(placementCapOf(later - 1, recent, limits), placed).kind,
    ).toBe('refused')
    expect(
      decidePlacement(placementCapOf(later, recent, limits), placed),
    ).toEqual({ kind: 'allowed' })
  })
  test('F42-AC17: Given slides made at the very edge of the window, When a new one is asked for, Then one made exactly 24 hours ago does not count and one a second later does', () => {
    expect(decide([now - DAY, now - 20, now - 30])).toEqual({
      kind: 'allowed',
    })
    expect(decide([now - DAY + 1, now - 20, now - 30]).kind).toBe('refused')
  })
  test('F42-AC17: Given slides made before the window, When a new one is asked for, Then they do not count', () => {
    expect(decide([now - DAY - 1, now - DAY - 2, now - 5 * DAY])).toEqual({
      kind: 'allowed',
    })
  })
  test('F42-AC17: Given a time in the future, When slides are counted, Then it is not counted', () => {
    expect(decide([now + 5, now - 20, now - 30])).toEqual({ kind: 'allowed' })
  })
  test('F42-AC21: Given the same slides made by someone who registered over 7 days ago, When a new one is asked for, Then the limit does not apply', () => {
    expect(decide([now - 10, now - 20, now - 30], now - 8 * DAY)).toEqual({
      kind: 'allowed',
    })
    expect(decide([now - 10, now - 20, now - 30], null)).toEqual({
      kind: 'allowed',
    })
  })
  test('F42-AC22: Given a limit of 1, When one slide is in the window, Then the next is refused', () => {
    expect(
      decide([now - 1], recent, parseNewAuthorLimits({ perDay: 1 })).kind,
    ).toBe('refused')
  })
})
