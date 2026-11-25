import { describe, expect, test } from 'vitest'
import { isCalendar, lumaEventKeys } from './ical'
import {
  MOCK_ETAG,
  MOCK_FEED,
  MOCK_LAST_MODIFIED,
  mockAnswer,
} from './mock-feed'

const none = { ifNoneMatch: null, ifModifiedSince: null }

describe('the local feed', () => {
  test('F33-AC16: Given the fixed feed, When it is read, Then the event on its URL line and the one in its DESCRIPTION come out', () => {
    expect(isCalendar(MOCK_FEED)).toBe(true)
    expect(lumaEventKeys(MOCK_FEED)).toEqual([
      'https://luma.com/slide-mock-one',
      'https://luma.com/slide-mock-two',
    ])
  })

  test('F33-AC5: Given any other calendar, When it is asked first and then with a validator, Then it answers 200 with validators, then 304', () => {
    expect(mockAnswer('cal-kpm', none)).toEqual({
      kind: 'fixed',
      status: 200,
      headers: expect.objectContaining({
        ETag: MOCK_ETAG,
        'Last-Modified': MOCK_LAST_MODIFIED,
      }),
      body: MOCK_FEED,
    })
    expect(
      mockAnswer('cal-kpm', { ...none, ifNoneMatch: MOCK_ETAG }),
    ).toMatchObject({
      status: 304,
    })
    expect(
      mockAnswer('cal-kpm', { ...none, ifModifiedSince: MOCK_LAST_MODIFIED }),
    ).toMatchObject({ status: 304 })
    expect(
      mockAnswer('cal-kpm', { ...none, ifNoneMatch: '"other"' }),
    ).toMatchObject({
      status: 200,
    })
  })

  test.each([
    [
      'cal-mock429',
      { kind: 'fixed', status: 429, headers: { 'Retry-After': '7200' } },
    ],
    [
      'cal-mock503',
      { kind: 'fixed', status: 503, headers: { 'Retry-After': '3600' } },
    ],
    ['cal-mock500', { kind: 'fixed', status: 500 }],
    ['cal-mockRedirect', { kind: 'fixed', status: 302 }],
    ['cal-mockHtml', { kind: 'fixed', status: 200 }],
    ['cal-mockLarge', { kind: 'large', bytes: 2 * 1024 * 1024 + 1 }],
    ['cal-mockSlow', { kind: 'slow', ms: 11_000 }],
  ])(
    'Given the calendar %s, When it is asked, Then it answers %o',
    (id, answer) => {
      expect(mockAnswer(id, none)).toMatchObject(answer)
    },
  )
})
