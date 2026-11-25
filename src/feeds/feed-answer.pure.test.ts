import { describe, expect, test } from 'vitest'
import {
  answerOfStatus,
  declaredTooLarge,
  feedRequestHeaders,
  validatorsOf,
} from './feed-answer'

const none = { etag: null, lastModified: null }
const sent = { etag: '"v1"', lastModified: 'Tue, 24 Nov 2026 00:00:00 GMT' }

describe('the request', () => {
  test("F33-AC6: Given any request, When its headers are built, Then the User-Agent is the bot's", () => {
    expect(feedRequestHeaders(none)['User-Agent']).toBe(
      'slide.community-bot/1.0 (+https://slide.community/help/bot)',
    )
    expect(feedRequestHeaders(sent)['User-Agent']).toBe(
      'slide.community-bot/1.0 (+https://slide.community/help/bot)',
    )
  })

  test('F33-AC5: Given no earlier full answer, When the first request is built, Then it is not conditional', () => {
    const headers = feedRequestHeaders(none)
    expect(headers).not.toHaveProperty('If-None-Match')
    expect(headers).not.toHaveProperty('If-Modified-Since')
  })

  test.each([
    [{ etag: '"v1"', lastModified: null }, { 'If-None-Match': '"v1"' }],
    [
      { etag: null, lastModified: 'Tue, 24 Nov 2026 00:00:00 GMT' },
      { 'If-Modified-Since': 'Tue, 24 Nov 2026 00:00:00 GMT' },
    ],
    [
      sent,
      {
        'If-None-Match': '"v1"',
        'If-Modified-Since': 'Tue, 24 Nov 2026 00:00:00 GMT',
      },
    ],
  ])(
    'F33-AC5: Given the validators %o of the last full answer, When the next request is built, Then it asks with them',
    (validators, expected) => {
      expect(feedRequestHeaders(validators)).toMatchObject(expected)
    },
  )
})

describe('the answer', () => {
  test('F33-AC5: Given a 304, When it is read, Then the validators sent are kept, or the new ones it names', () => {
    expect(answerOfStatus(304, new Headers(), sent)).toEqual({
      kind: 'not_modified',
      validators: sent,
    })
    expect(answerOfStatus(304, new Headers({ ETag: '"v2"' }), sent)).toEqual({
      kind: 'not_modified',
      validators: { ...sent, etag: '"v2"' },
    })
  })

  test('F33-AC5: Given validators too long to keep, When an answer is read, Then they are dropped', () => {
    expect(
      validatorsOf(
        new Headers({ ETag: 'x'.repeat(257), 'Last-Modified': 'y'.repeat(65) }),
      ),
    ).toEqual(none)
    expect(validatorsOf(new Headers({ ETag: 'x'.repeat(256) })).etag).toBe(
      'x'.repeat(256),
    )
  })

  test.each([301, 302, 303, 307, 308, 300, 399])(
    'F33-AC10: Given a %i, When it is read, Then it is a failure and not followed',
    (status) => {
      expect(
        answerOfStatus(
          status,
          new Headers({ Location: 'https://evil.example/' }),
          none,
        ),
      ).toEqual({ kind: 'failed', reason: 'redirect', retryAfter: null })
    },
  )

  test.each([
    [429, 'rate_limited'],
    [503, 'unavailable'],
  ] as const)(
    'F33-AC7: Given a %i with Retry-After, When it is read, Then the Retry-After is kept with the failure',
    (status, reason) => {
      expect(
        answerOfStatus(status, new Headers({ 'Retry-After': '120' }), none),
      ).toEqual({ kind: 'failed', reason, retryAfter: '120' })
      expect(answerOfStatus(status, new Headers(), none)).toEqual({
        kind: 'failed',
        reason,
        retryAfter: null,
      })
    },
  )

  test.each([201, 204, 400, 403, 404, 410, 500, 502, 504, 100])(
    'Given a %i, When it is read, Then it is a failure without Retry-After',
    (status) => {
      expect(
        answerOfStatus(status, new Headers({ 'Retry-After': '9' }), none),
      ).toEqual({ kind: 'failed', reason: 'http_error', retryAfter: null })
    },
  )

  test('Given a 200, When its status is read, Then its body is to be read', () => {
    expect(answerOfStatus(200, new Headers(), none)).toEqual({ kind: 'read' })
  })

  test.each([
    ['2097153', true],
    ['2097152', false],
    ['0', false],
    ['-1', false],
    ['abc', false],
    ['99999999999999999999', true],
  ])(
    'F33-AC11: Given a declared length of %s, When it is checked against 2 MB, Then it is too large: %s',
    (length, expected) => {
      expect(
        declaredTooLarge(
          new Headers({ 'Content-Length': length }),
          2 * 1024 * 1024,
        ),
      ).toBe(expected)
    },
  )
})
