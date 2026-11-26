import { expect, test } from 'vitest'
import {
  addDays,
  COPY_LOOKBACK_DAYS,
  dayOf,
  daysToCopy,
  isDay,
  startOfDay,
} from './day'

const at = (iso: string) => Date.parse(iso) / 1000

test.each([
  ['2026-11-26', true],
  ['2024-02-29', true],
  ['2026-02-29', false],
  ['2026-13-01', false],
  ['2026-00-10', false],
  ['2026-11-31', false],
  ['2026-1-1', false],
  ['20261126', false],
  ['2026-11-26 ', false],
  ["2026-11-26' OR 1=1 --", false],
  ['', false],
])(
  'F40-AC17: Given %j, When it is read as a day, Then it is %s',
  (text, ok) => {
    expect(isDay(text)).toBe(ok)
  },
)

test('F40-AC17: Given times around midnight UTC, When the day is read, Then the day changes exactly at 00:00:00Z', () => {
  expect(dayOf(at('2026-11-25T23:59:59Z'))).toBe('2026-11-25')
  expect(dayOf(at('2026-11-26T00:00:00Z'))).toBe('2026-11-26')
  expect(startOfDay(dayOf(at('2026-11-26T12:00:00Z')))).toBe(
    at('2026-11-26T00:00:00Z'),
  )
})

test.each([
  ['2026-11-26', 1, '2026-11-27'],
  ['2026-11-26', -1, '2026-11-25'],
  ['2026-12-31', 1, '2027-01-01'],
  ['2024-02-28', 1, '2024-02-29'],
  ['2024-02-29', 1, '2024-03-01'],
  ['2026-03-01', -1, '2026-02-28'],
  ['2026-11-26', 0, '2026-11-26'],
  ['2026-11-26', -6, '2026-11-20'],
])(
  'F40-AC17: Given %s, When %i days are added, Then it is %s',
  (day, count, expected) => {
    expect(addDays(day as never, count)).toBe(expected)
  },
)

test('F40-AC17: Given a copy at 20:17 UTC with nothing copied, When the days are chosen, Then they are the last seven up to yesterday, oldest first, and not today', () => {
  expect(daysToCopy(at('2026-11-26T20:17:00Z'), new Set())).toEqual([
    '2026-11-19',
    '2026-11-20',
    '2026-11-21',
    '2026-11-22',
    '2026-11-23',
    '2026-11-24',
    '2026-11-25',
  ])
  expect(COPY_LOOKBACK_DAYS).toBe(7)
})

test('F40-AC17: Given a copy right after midnight, When the days are chosen, Then the day that just ended is included', () => {
  const days = daysToCopy(at('2026-11-27T00:00:01Z'), new Set())
  expect(days.at(-1)).toBe('2026-11-26')
})

test('F40-AC17: Given some days copied, When the days are chosen, Then only the rest are, and none when all are', () => {
  const copied = new Set(['2026-11-19', '2026-11-21', '2026-11-25'])
  expect(daysToCopy(at('2026-11-26T20:17:00Z'), copied)).toEqual([
    '2026-11-20',
    '2026-11-22',
    '2026-11-23',
    '2026-11-24',
  ])
  expect(
    daysToCopy(
      at('2026-11-26T20:17:00Z'),
      new Set([
        '2026-11-19',
        '2026-11-20',
        '2026-11-21',
        '2026-11-22',
        '2026-11-23',
        '2026-11-24',
        '2026-11-25',
      ]),
    ),
  ).toEqual([])
})

test('F40-AC17: Given a day older than the week, When it is copied already, Then it makes no difference', () => {
  expect(
    daysToCopy(at('2026-11-26T20:17:00Z'), new Set(['2026-01-01'])),
  ).toHaveLength(7)
})
