import { expect, test } from 'vitest'
import { dayFormats } from './dates'

// 2026-11-19T15:30:00Z is already the 20th in Tokyo.
const LATE = Date.UTC(2026, 10, 19, 15, 30)

test('Given a moment, When it is written in Japanese, Then it reads as 年月日 on the Tokyo calendar', () => {
  expect(dayFormats.ja.format(Date.UTC(2026, 10, 19, 3))).toBe('2026年11月19日')
  expect(dayFormats.ja.format(LATE)).toBe('2026年11月20日')
})

test('Given a moment, When it is written in English, Then it reads as a short month, day and year on the Tokyo calendar', () => {
  expect(dayFormats.en.format(LATE)).toBe('Nov 20, 2026')
})

test.each([0, Date.UTC(1999, 11, 31, 15)])(
  'Given the moment %d, When it is written, Then no ISO 8601 text shows in either language',
  (moment) => {
    for (const format of Object.values(dayFormats))
      expect(format.format(moment)).not.toMatch(/\d{4}-\d{2}-\d{2}|T\d{2}:/)
  },
)
