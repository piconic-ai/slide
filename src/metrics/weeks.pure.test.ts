import { expect, test } from 'vitest'
import { lastWeeks, mondayOf } from './weeks'

const at = (iso: string) => Date.parse(iso) / 1000

test.each([
  ['2026-11-23', '2026-11-23'],
  ['2026-11-24', '2026-11-23'],
  ['2026-11-26', '2026-11-23'],
  ['2026-11-29', '2026-11-23'],
  ['2026-11-30', '2026-11-30'],
  ['2027-01-01', '2026-12-28'],
  ['2024-03-01', '2024-02-26'],
  ['1970-01-01', '1969-12-29'],
])(
  'F40-AC18: Given %s, When its week is found, Then the week starts on the Monday %s',
  (day, monday) => {
    expect(mondayOf(day as never)).toBe(monday)
  },
)

test('F40-AC18: Given a time on a Thursday, When the last 12 weeks are made, Then they are 12 weeks of 7 days from Mondays, oldest first, the newest holding the time', () => {
  const weeks = lastWeeks(at('2026-11-26T20:17:00Z'))
  expect(weeks).toHaveLength(12)
  expect(weeks[11]).toEqual({ start: '2026-11-23', end: '2026-11-29' })
  expect(weeks[0]).toEqual({ start: '2026-09-07', end: '2026-09-13' })
  for (const [i, week] of weeks.entries()) {
    if (i === 0) continue
    // Each begins the day after the one before ended.
    const before = weeks[i - 1]!
    expect(
      Date.parse(`${week.start}T00:00:00Z`) -
        Date.parse(`${before.end}T00:00:00Z`),
    ).toBe(86_400_000)
  }
})

test('F40-AC18: Given a time at the very end of a Sunday and the start of a Monday, When the weeks are made, Then the newest week changes between them', () => {
  expect(lastWeeks(at('2026-11-29T23:59:59Z'))[11]?.start).toBe('2026-11-23')
  expect(lastWeeks(at('2026-11-30T00:00:00Z'))[11]?.start).toBe('2026-11-30')
})

test('F40-AC18: Given another count, When the weeks are made, Then there are that many, and 0 gives none', () => {
  expect(lastWeeks(at('2026-11-26T00:00:00Z'), 4)).toHaveLength(4)
  expect(lastWeeks(at('2026-11-26T00:00:00Z'), 0)).toEqual([])
})
