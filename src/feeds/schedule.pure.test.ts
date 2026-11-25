import { describe, expect, test } from 'vitest'
import type { FeedAnswer, FeedFailure } from './feed-answer'
import {
  backoffAfter,
  claimedRecord,
  isReadable,
  newFeedRecord,
  recordAfter,
  requestedRecord,
  resumedRecord,
  retryAfterAt,
  type FeedRecord,
} from './schedule'

const FEED = 'https://api.lu.ma/ics/get?entity=calendar&id=cal-abc'
const HOUR = 3600
const DAY = 86400
const T = 1_800_000_000

const ok: FeedAnswer = {
  kind: 'full',
  body: '',
  validators: { etag: '"v1"', lastModified: null },
}
const failed = (
  reason: FeedFailure,
  retryAfter: string | null = null,
): FeedAnswer => ({ kind: 'failed', reason, retryAfter })

/** Reads the record at `at`: claims it, then records the outcome. */
const readAt = (record: FeedRecord, outcome: FeedAnswer, at: number) =>
  recordAfter(claimedRecord(record, at), outcome, at)

describe('when a feed is read', () => {
  test('Given a feed never read, When it is looked at, Then it is due at once', () => {
    expect(isReadable(newFeedRecord(FEED), T)).toBe(true)
  })

  test('F33-AC14: Given a feed just read, When a day has not passed, Then it is not due, and when a day passed, Then it is', () => {
    const read = readAt(newFeedRecord(FEED), ok, T)
    expect(isReadable(read, T + DAY - 1)).toBe(false)
    expect(isReadable(read, T + DAY)).toBe(true)
  })

  test('F33-AC3: Given a feed read now and any number of early requests, When they come within the hour, Then it is not read again before the hour', () => {
    let record = claimedRecord(newFeedRecord(FEED), T)
    for (let at = T; at < T + HOUR; at += 60) {
      record = requestedRecord(record, at)
      expect(isReadable(record, at)).toBe(false)
    }
    expect(isReadable(requestedRecord(record, T + HOUR), T + HOUR)).toBe(true)
  })

  test('F33-AC2: Given a feed read more than an hour ago, When an early read is asked for, Then it is due at once', () => {
    const read = readAt(newFeedRecord(FEED), ok, T)
    expect(isReadable(requestedRecord(read, T + HOUR), T + HOUR)).toBe(true)
  })

  test('Given a request for a later read, When it is recorded, Then a sooner due time is kept', () => {
    expect(requestedRecord(newFeedRecord(FEED), T).dueAt).toBe(0)
  })
})

describe('after a read', () => {
  test('F33-AC5: Given a full answer, then a 304, When they are recorded, Then the validators of the full answer are kept', () => {
    const first = readAt(newFeedRecord(FEED), ok, T)
    expect(first.validators).toEqual({ etag: '"v1"', lastModified: null })
    const second = readAt(
      first,
      { kind: 'not_modified', validators: first.validators },
      T + DAY,
    )
    expect(second.validators).toEqual(first.validators)
    expect(second.dueAt).toBe(T + 2 * DAY)
  })

  test('F33-AC8: Given failures in a row, When each is recorded, Then the wait doubles from an hour up to a day', () => {
    let record = newFeedRecord(FEED)
    let at = T
    const waits: number[] = []
    for (let n = 1; n <= 4; n += 1) {
      record = readAt(record, failed('http_error'), at)
      waits.push(record.notBefore - at)
      expect(isReadable(record, record.notBefore - 1)).toBe(false)
      expect(isReadable(record, record.notBefore)).toBe(true)
      at = record.notBefore
    }
    expect(waits).toEqual([HOUR, 2 * HOUR, 4 * HOUR, 8 * HOUR])
  })

  test.each([
    [1, HOUR],
    [2, 2 * HOUR],
    [5, 16 * HOUR],
    [6, DAY],
    [40, DAY],
    [0, HOUR],
  ])(
    'F33-AC8: Given %i failures, When the wait is set, Then it is %i seconds',
    (n, wait) => {
      expect(backoffAfter(n)).toBe(wait)
    },
  )

  test('F33-AC9: Given four failures, When the fifth in a row is recorded, Then the feed stops with its reason and is not read', () => {
    let record = newFeedRecord(FEED)
    let at = T
    for (let n = 1; n <= 4; n += 1) {
      record = readAt(record, failed('timeout'), at)
      expect(record.state.kind).toBe('active')
      at = record.notBefore
    }
    record = readAt(record, failed('too_large'), at)
    expect(record.state).toEqual({ kind: 'stopped', at, reason: 'too_large' })
    expect(isReadable(record, at + 365 * DAY)).toBe(false)
    expect(isReadable(requestedRecord(record, at + DAY), at + DAY)).toBe(false)
  })

  test('F33-AC9: Given a failure, When a success follows, Then the count of failures starts again', () => {
    let record = readAt(newFeedRecord(FEED), failed('network'), T)
    record = readAt(record, ok, record.notBefore)
    expect(record.failures).toBe(0)
    expect(record.state).toEqual({ kind: 'active', lastFailure: null })
  })

  test('F33-AC9: Given a stopped feed, When an operator resumes it, Then it is read again, but not within the hour of the last request', () => {
    let record = newFeedRecord(FEED)
    let at = T
    for (let n = 1; n <= 5; n += 1) {
      record = readAt(record, failed('network'), at)
      at = record.notBefore
    }
    const stoppedAt = record.readAt ?? 0
    const soon = resumedRecord(record, stoppedAt + 60)
    expect(soon.failures).toBe(0)
    expect(isReadable(soon, stoppedAt + 60)).toBe(false)
    expect(isReadable(soon, stoppedAt + HOUR)).toBe(true)
    const later = resumedRecord(record, stoppedAt + DAY)
    expect(isReadable(later, stoppedAt + DAY)).toBe(true)
  })

  test.each([
    ['rate_limited', '7200', 7200],
    ['unavailable', '86400', 86400],
    ['rate_limited', '172800', 172800],
    ['unavailable', 'Sat, 31 Dec 2030 00:00:00 GMT', 1924905600 - T],
  ] as const)(
    'F33-AC7: Given a %s with Retry-After %s, When it is recorded, Then the feed is not read until that time',
    (reason, retryAfter, wait) => {
      const record = readAt(newFeedRecord(FEED), failed(reason, retryAfter), T)
      expect(record.notBefore).toBe(T + wait)
      expect(record.retryUntil).toBe(T + wait)
      expect(isReadable(record, T + wait - 1)).toBe(false)
      expect(
        isReadable(requestedRecord(record, T + wait - 1), T + wait - 1),
      ).toBe(false)
    },
  )

  test('F33-AC7: Given a Retry-After shorter than the hour, When it is recorded, Then the hour still holds', () => {
    const record = readAt(newFeedRecord(FEED), failed('rate_limited', '5'), T)
    expect(record.notBefore).toBe(T + HOUR)
  })

  test('F33-AC7: Given a feed stopped by a 429 with a long Retry-After, When it is resumed, Then it waits for that time', () => {
    let record = newFeedRecord(FEED)
    let at = T
    for (let n = 1; n <= 5; n += 1) {
      record = readAt(record, failed('rate_limited', String(3 * DAY)), at)
      at = record.notBefore
    }
    const resumed = resumedRecord(record, at)
    expect(resumed.notBefore).toBe(record.retryUntil)
    expect(isReadable(resumed, (record.retryUntil ?? 0) - 1)).toBe(false)
  })

  test('Given a Retry-After on another failure, When it is recorded, Then it is not taken', () => {
    const record = readAt(newFeedRecord(FEED), failed('http_error', '99999'), T)
    expect(record.retryUntil).toBeNull()
  })
})

describe('Retry-After', () => {
  test.each([
    ['120', T + 120],
    [' 120 ', T + 120],
    ['0', null],
    ['-5', null],
    ['1.5', null],
    ['12345678901', null],
    ['', null],
    [null, null],
    ['soon', null],
    ['Sat, 31 Dec 2030 00:00:00 GMT', 1924905600],
    ['Thu, 01 Jan 1970 00:00:00 GMT', null],
    ['Sat, 31 Dec 2030 00:00:00 PST', null],
    ['2030-12-31T00:00:00Z', null],
    ['Sat, 99 Dec 2030 00:00:00 GMT', null],
  ])('Given %o, When it is read, Then it names %o', (value, at) => {
    expect(retryAfterAt(value, T)).toBe(at)
  })
})
