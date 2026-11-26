import { describe, expect, test } from 'vitest'
import {
  decidePlacement,
  isNewAuthor,
  parseNewAuthorLimits,
  placementWindowOf,
  type PlacementWindow,
} from './new-author-limits'

const DAY = 86_400
const limits = parseNewAuthorLimits({})
const rolling = (now: number): PlacementWindow => ({
  since: now - DAY,
  availableAt: (placed) => Math.min(...placed) + DAY,
})

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

describe('the decision, given a window', () => {
  const now = 1_000_000
  const recent = now - 3 * DAY
  const decide = (placedAt: number[], registeredAt: number | null = recent) =>
    decidePlacement({
      now,
      registeredAt,
      limits,
      window: rolling(now),
      placedAt,
    })

  test('F42-AC19: Given fewer new slides than the limit in the window, When a new one is asked for, Then it is allowed', () => {
    expect(decide([])).toEqual({ kind: 'allowed' })
    expect(decide([now - 10, now - 20])).toEqual({ kind: 'allowed' })
  })
  test('F42-AC19: Given the limit reached in the window, When a new one is asked for, Then it is refused until the oldest leaves the window', () => {
    expect(decide([now - 10, now - 20, now - 30])).toEqual({
      kind: 'refused',
      availableAt: now - 30 + DAY,
    })
  })
  test('F42-AC19: Given slides made before the window, When a new one is asked for, Then they do not count', () => {
    expect(decide([now - DAY - 1, now - DAY - 2, now - 5 * DAY])).toEqual({
      kind: 'allowed',
    })
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
      decidePlacement({
        now,
        registeredAt: recent,
        limits: parseNewAuthorLimits({ perDay: 1 }),
        window: rolling(now),
        placedAt: [now - 1],
      }).kind,
    ).toBe('refused')
  })
})

test('Given no definition of a day yet, When anyone is judged, Then nothing is limited and the window is not made up', () => {
  expect(placementWindowOf(1_000_000)).toBeNull()
  expect(
    decidePlacement({
      now: 10,
      registeredAt: 9,
      limits,
      window: null,
      placedAt: [1, 2, 3, 4, 5],
    }),
  ).toEqual({ kind: 'allowed' })
})

test.todo(
  'F42-AC17: held (D-130 does not say what a day is): a person registered within 7 days may put up 3 new slides in a day',
)
test.todo(
  'F42-AC18: held (the same): the 4th is refused with the reason and when the next may be put up',
)
