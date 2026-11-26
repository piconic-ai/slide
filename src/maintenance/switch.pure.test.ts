import { describe, expect, test } from 'vitest'
import {
  DEFAULT_RETRY_AFTER_SECONDS,
  expectedEnd,
  formatUntil,
  isMaintenance,
  maintenanceHeaders,
  maintenanceHeaderValue,
  MAX_RETRY_AFTER_SECONDS,
  parseSwitch,
  parseUntil,
  retryAfterSeconds,
} from './switch'

const UNTIL = '2026-12-01T03:00:00Z'
const UNTIL_SECONDS = Date.UTC(2026, 11, 1, 3, 0, 0) / 1000

describe('F38-AC15 F38-AC16: the value of the secret', () => {
  test.each([
    [undefined, 'off'],
    ['', 'off'],
    ['   ', 'off'],
    ['off', 'off'],
    [' OFF ', 'off'],
  ])('Given %j, When read, Then maintenance is off', (value, kind) => {
    expect(parseSwitch(value).kind).toBe(kind)
    expect(isMaintenance(value)).toBe(false)
  })

  test('F38-AC15: Given the value on, When read, Then it holds the service with no end and no reason, as it always did', () => {
    expect(parseSwitch('on')).toEqual({ kind: 'on', until: null, reason: null })
    expect(isMaintenance('on')).toBe(true)
  })

  test('Given an end and a reason, When read, Then both are kept', () => {
    expect(parseSwitch(`on;until=${UNTIL};reason=database`)).toEqual({
      kind: 'on',
      until: UNTIL_SECONDS,
      reason: 'database',
    })
  })

  test.each([
    [`on;until=${UNTIL}`, UNTIL_SECONDS, null],
    ['on;reason=update', null, 'update'],
    [`on;reason=other;until=${UNTIL}`, UNTIL_SECONDS, 'other'],
    [
      ` ON ; Until = ${UNTIL.toLowerCase()} ; Reason = DATABASE `,
      UNTIL_SECONDS,
      'database',
    ],
    [`on;until=${UNTIL};until=2030-01-01T00:00:00Z`, UNTIL_SECONDS, null],
    [`on;color=red;until=${UNTIL}`, UNTIL_SECONDS, null],
  ])(
    'Given %j, When read, Then the end is %j and the reason %j',
    (value, until, reason) => {
      expect(parseSwitch(value)).toEqual({ kind: 'on', until, reason })
    },
  )

  test.each([
    'true',
    'ON!',
    'yes',
    'garbled value',
    'until=2026-12-01',
    'on;until=2026-12-01',
    'on;until=2026-12-01T03:00:00',
    'on;until=2026-12-01T03:00:00+09:00',
    'on;until=2026-02-30T03:00:00Z',
    'on;until=2026-13-01T03:00:00Z',
    'on;until=2026-12-01T25:00:00Z',
    'on;until=tomorrow',
    'on;until=',
    'on;reason=',
    'on;reason=because',
    'on;;;',
    'on;=x',
    '<script>alert(1)</script>',
    'on;until=2026-12-01T03:00:00Z;reason=database;'.repeat(50),
  ])(
    'F38-AC16: Given the unreadable value %j, When read, Then the service is held all the same',
    (value) => {
      const sw = parseSwitch(value)
      expect(sw.kind).toBe('on')
      expect(isMaintenance(value)).toBe(true)
    },
  )

  test('F38-AC16: Given an end that cannot be read beside a reason that can, When read, Then the reason is kept and no end is made up', () => {
    expect(parseSwitch('on;until=soon;reason=update')).toEqual({
      kind: 'on',
      until: null,
      reason: 'update',
    })
  })
})

describe('the end as a time', () => {
  test('Given the form, When parsed and written back, Then it is the same', () => {
    expect(parseUntil(UNTIL)).toBe(UNTIL_SECONDS)
    expect(formatUntil(UNTIL_SECONDS)).toBe(UNTIL)
  })

  test.each(['2026-02-29T00:00:00Z', '2024-02-29T00:00:00Z'])(
    'Given %s, When parsed, Then only a real day is accepted',
    (value) => {
      expect(parseUntil(value) !== null).toBe(value.startsWith('2024'))
    },
  )

  test('Given the first and the last moment of a year, When parsed, Then both are read', () => {
    expect(parseUntil('2026-01-01T00:00:00Z')).toBe(Date.UTC(2026, 0, 1) / 1000)
    expect(parseUntil('2026-12-31T23:59:59Z')).toBe(
      Date.UTC(2026, 11, 31, 23, 59, 59) / 1000,
    )
  })
})

describe('F38-AC13 F38-AC14: how long to wait', () => {
  const on = (until: number | null) =>
    ({ kind: 'on', until, reason: null }) as const

  test('F38-AC13: Given an end 90 minutes ahead, When Retry-After is made, Then it is the seconds until then', () => {
    expect(retryAfterSeconds(on(UNTIL_SECONDS), UNTIL_SECONDS - 5400)).toBe(
      5400,
    )
  })

  test('F38-AC13: Given an end half a second ahead, When Retry-After is made, Then it is rounded up to 1, never 0', () => {
    expect(retryAfterSeconds(on(UNTIL_SECONDS), UNTIL_SECONDS - 0.5)).toBe(1)
  })

  test.each([
    ['no end', on(null), 0],
    ['an end that has passed', on(UNTIL_SECONDS), UNTIL_SECONDS + 1],
    ['an end that is now', on(UNTIL_SECONDS), UNTIL_SECONDS],
  ])(
    'F38-AC14: Given %s, When Retry-After is made, Then it is 300',
    (_, sw, now) => {
      expect(retryAfterSeconds(sw, now)).toBe(DEFAULT_RETRY_AFTER_SECONDS)
      expect(DEFAULT_RETRY_AFTER_SECONDS).toBe(300)
    },
  )

  test('Given an end a year ahead, When Retry-After is made, Then it asks for a day at most', () => {
    expect(
      retryAfterSeconds(on(UNTIL_SECONDS), UNTIL_SECONDS - 365 * 86400),
    ).toBe(MAX_RETRY_AFTER_SECONDS)
  })

  test('Given the switch off, When Retry-After is made, Then it is 300', () => {
    expect(retryAfterSeconds({ kind: 'off' }, 0)).toBe(300)
  })

  test('Given an end that has passed, When the expected end is asked for, Then there is none', () => {
    expect(expectedEnd(on(UNTIL_SECONDS), UNTIL_SECONDS + 1)).toBeNull()
    expect(expectedEnd(on(UNTIL_SECONDS), UNTIL_SECONDS - 1)).toBe(
      UNTIL_SECONDS,
    )
    expect(expectedEnd({ kind: 'off' }, 0)).toBeNull()
  })
})

describe('F38-AC23: the headers of the 503', () => {
  test('Given an end ahead, When the headers are made, Then they carry the wait, the intent and the maintenance mark with the end', () => {
    expect(
      maintenanceHeaders(
        { kind: 'on', until: UNTIL_SECONDS, reason: 'database' },
        UNTIL_SECONDS - 600,
      ),
    ).toEqual({
      'Retry-After': '600',
      'X-Slide-Intended': 'maintenance',
      'X-Slide-Maintenance': `on;until=${UNTIL}`,
    })
  })

  test('Given no end, When the headers are made, Then the mark is on, and the reason is never in it', () => {
    const headers = maintenanceHeaders(
      { kind: 'on', until: null, reason: 'database' },
      0,
    )
    expect(headers['X-Slide-Maintenance']).toBe('on')
    expect(headers['Retry-After']).toBe('300')
    expect(JSON.stringify(headers)).not.toContain('database')
    expect(
      maintenanceHeaderValue(
        { kind: 'on', until: UNTIL_SECONDS, reason: null },
        UNTIL_SECONDS + 5,
      ),
    ).toBe('on')
  })
})
