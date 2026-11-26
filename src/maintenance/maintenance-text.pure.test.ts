import { expect, test } from 'vitest'
import {
  formatJst,
  formatUtc,
  reasonLabel,
  reasonSentence,
} from './maintenance-text'
import { MAINTENANCE_REASONS } from './switch'

const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  Date.UTC(y, mo - 1, d, h, mi) / 1000

test('F38-AC2: Given 03:00 UTC, When shown in Japan time, Then it is 12:00 on the same day, in the words of each language', () => {
  expect(formatJst(at(2026, 12, 1, 3), 'ja')).toBe('2026年12月1日 12:00')
  expect(formatJst(at(2026, 12, 1, 3), 'en')).toBe('Dec 1, 2026, 12:00 JST')
})

test.each([
  [at(2026, 12, 31, 15), '2027年1月1日 00:00', 'Jan 1, 2027, 00:00 JST'],
  [at(2026, 12, 31, 14, 59), '2026年12月31日 23:59', 'Dec 31, 2026, 23:59 JST'],
  [at(2028, 2, 28, 15), '2028年2月29日 00:00', 'Feb 29, 2028, 00:00 JST'],
])(
  'Given a moment near a day, a year or a leap day, When shown in Japan time, Then the date rolls over with it',
  (seconds, ja, en) => {
    expect(formatJst(seconds, 'ja')).toBe(ja)
    expect(formatJst(seconds, 'en')).toBe(en)
  },
)

test('F38-AC9: Given a moment, When shown in UTC, Then it is the same in both languages', () => {
  expect(formatUtc(at(2026, 12, 1, 3, 5))).toBe('2026-12-01 03:05 UTC')
})

test.each(MAINTENANCE_REASONS)(
  'F38-AC11: Given the reason %s, When it is told, Then each language has a label and a sentence of its own',
  (reason) => {
    for (const lang of ['ja', 'en'] as const) {
      expect(reasonLabel(reason, lang).length).toBeGreaterThan(0)
      expect(reasonSentence(reason, lang)).toMatch(/[。.]$/)
    }
    expect(reasonSentence(reason, 'ja')).not.toBe(reasonSentence(reason, 'en'))
  },
)

test('F38-AC11: Given the three reasons, When told in Japanese, Then they are the database, the update and the rest', () => {
  expect(MAINTENANCE_REASONS.map((r) => reasonLabel(r, 'ja'))).toEqual([
    'データベースの保守',
    'サービスの更新',
    'その他',
  ])
})
