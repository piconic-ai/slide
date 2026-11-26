import { describe, expect, test } from 'vitest'
import {
  isShown,
  NOTICE_MAX_AHEAD_SECONDS,
  NOTICE_SOON_SECONDS,
  parseJstLocal,
  parseNoticeForm,
  type NoticeForm,
} from './notice'

/** Seconds of a moment given in Japan time. */
const jst = (y: number, mo: number, d: number, h: number, mi = 0) =>
  Date.UTC(y, mo - 1, d, h - 9, mi) / 1000

const NOW = jst(2026, 11, 26, 12)

const form = (over: Partial<NoticeForm> = {}): NoticeForm => ({
  startsAt: '2026-12-01T12:00',
  endsAt: '2026-12-01T15:00',
  reason: 'database',
  ...over,
})

describe('F38-AC1: a datetime-local value is Japan time', () => {
  test('Given 12:00 on 1 Dec, When read, Then it is 03:00 UTC', () => {
    expect(parseJstLocal('2026-12-01T12:00')).toBe(
      Date.UTC(2026, 11, 1, 3, 0) / 1000,
    )
  })

  test.each([
    ['2026-12-01T00:00', Date.UTC(2026, 10, 30, 15, 0) / 1000],
    ['2026-12-01T08:59', Date.UTC(2026, 10, 30, 23, 59) / 1000],
    ['2026-12-01T09:00', Date.UTC(2026, 11, 1, 0, 0) / 1000],
    ['2026-12-01T12:00:30', Date.UTC(2026, 11, 1, 3, 0, 30) / 1000],
    [' 2026-12-01T12:00 ', Date.UTC(2026, 11, 1, 3, 0) / 1000],
  ])('Given %j, When read, Then the day rolls over with the offset', (v, s) => {
    expect(parseJstLocal(v)).toBe(s)
  })

  test.each([
    '',
    'tomorrow',
    '2026-12-01',
    '2026-12-01 12:00',
    '2026-12-01T12',
    '2026-12-01T12:00Z',
    '2026-12-01T12:00+09:00',
    '2026-02-30T12:00',
    '2026-13-01T12:00',
    '2026-12-01T24:00',
    '2026-12-01T12:60',
    '２０２６-12-01T12:00',
    '2026-12-01T12:00<script>',
  ])('Given %j, When read, Then it is not a time', (v) => {
    expect(parseJstLocal(v)).toBeNull()
  })
})

describe('F38-AC4: when the band is shown', () => {
  const notice = { startsAt: 100, endsAt: 200, reason: 'update' } as const

  test.each([
    [0, true],
    [99, true],
    [100, true],
    [199, true],
    [200, false],
    [201, false],
  ])(
    'Given the end at 200, When it is %i, Then the band is shown: %s',
    (now, shown) => {
      expect(isShown(notice, now)).toBe(shown)
    },
  )
})

describe('F38-AC1 F38-AC6 F38-AC7: the form', () => {
  test('Given a plan next week, When read, Then it is a plan and there is no warning', () => {
    const input = parseNoticeForm(form(), NOW)
    expect(input).toEqual({
      kind: 'ok',
      notice: {
        startsAt: jst(2026, 12, 1, 12),
        endsAt: jst(2026, 12, 1, 15),
        reason: 'database',
      },
      soon: false,
    })
  })

  test.each([
    ['the start is the day after tomorrow', '2026-11-28T12:00', true],
    ['the start is 3 days ahead to the minute', '2026-11-29T12:00', false],
    ['the start is 3 days less a minute ahead', '2026-11-29T11:59', true],
    ['the start has already passed', '2026-11-26T09:00', true],
  ])(
    'F38-AC7: Given %s, When read, Then it is put in with soon %s',
    (_, start, soon) => {
      const input = parseNoticeForm(
        form({ startsAt: start, endsAt: '2026-12-10T00:00' }),
        NOW,
      )
      expect(input.kind).toBe('ok')
      expect(input.kind === 'ok' && input.soon).toBe(soon)
    },
  )

  test('F38-AC7: Given the limit of three days, When it is read, Then it is the one the screen says', () => {
    expect(NOTICE_SOON_SECONDS).toBe(3 * 86400)
  })

  test.each([
    ['the start cannot be read', { startsAt: 'soon' }, 'starts_at'],
    ['the start is empty', { startsAt: '' }, 'starts_at'],
    ['the end cannot be read', { endsAt: '2026-02-30T00:00' }, 'ends_at'],
    ['the end is empty', { endsAt: '' }, 'ends_at'],
    ['the reason is none of the three', { reason: 'because' }, 'reason'],
    ['the reason is empty', { reason: '' }, 'reason'],
    ['the end is the start', { endsAt: '2026-12-01T12:00' }, 'order'],
    ['the end is before the start', { endsAt: '2026-12-01T11:59' }, 'order'],
    [
      'the end has passed',
      { startsAt: '2026-11-01T00:00', endsAt: '2026-11-26T12:00' },
      'ended',
    ],
    ['the end is far off', { endsAt: '2027-12-01T12:00' }, 'too_far'],
  ] as const)(
    'Given %s, When read, Then nothing is put in and the field to fix is named',
    (_, over, problem) => {
      expect(parseNoticeForm(form(over), NOW)).toEqual({
        kind: 'invalid',
        problem,
      })
    },
  )

  test('Given an end exactly 90 days ahead, When read, Then it is put in, and a second more is too far', () => {
    const edge = NOW + NOTICE_MAX_AHEAD_SECONDS
    const at = (s: number) => {
      const d = new Date((s + 9 * 3600) * 1000).toISOString().slice(0, 19)
      return d
    }
    expect(
      parseNoticeForm(
        form({ startsAt: '2026-12-01T00:00', endsAt: at(edge) }),
        NOW,
      ).kind,
    ).toBe('ok')
    expect(
      parseNoticeForm(
        form({ startsAt: '2026-12-01T00:00', endsAt: at(edge + 1) }),
        NOW,
      ),
    ).toEqual({ kind: 'invalid', problem: 'too_far' })
  })

  test('Given markup in every field, When read, Then it is only invalid, never a plan', () => {
    const evil = '<img src=x onerror=alert(1)>'
    expect(
      parseNoticeForm({ startsAt: evil, endsAt: evil, reason: evil }, NOW).kind,
    ).toBe('invalid')
  })
})
