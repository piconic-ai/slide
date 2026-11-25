/**
 * The local stand-in for Luma's feeds (D-69), for tests and local starts
 * only: a fixed iCal file, and answers picked by the calendar's id in the
 * query string. See docs/dev/f33-luma-feeds.md.
 */
import { MAX_FEED_BYTES } from './limits'

/** The events the fixed feed lists: one on its URL line, one in its DESCRIPTION. */
export const MOCK_EVENTS = [
  'https://lu.ma/slide-mock-one',
  'https://luma.com/slide-mock-two',
] as const

/** The fixed feed. Its names and times are there to show they are not kept. */
export const MOCK_FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//slide.community//mock Luma feed//EN',
  'X-WR-CALNAME:Mock calendar',
  'BEGIN:VEVENT',
  'UID:slide-mock-one',
  'SUMMARY:Mock meetup one',
  'DTSTART:20261201T100000Z',
  'DTEND:20261201T120000Z',
  'LOCATION:Mock hall',
  `URL:${MOCK_EVENTS[0]}`,
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:slide-mock-two',
  'SUMMARY:Mock meetup two',
  'DTSTART:20261215T100000Z',
  `DESCRIPTION:Get up-to-date information at: ${MOCK_EVENTS[1]}\\n\\nSee you!`,
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n')

export const MOCK_ETAG = '"slide-mock-v1"'
export const MOCK_LAST_MODIFIED = 'Tue, 24 Nov 2026 00:00:00 GMT'

/** How long the slow answer waits, past the reader's limit. */
export const MOCK_SLOW_MS = 11_000

/** What the local feed answers. */
export type MockAnswer =
  | Readonly<{
      kind: 'fixed'
      status: number
      headers: Record<string, string>
      body: string | null
    }>
  /** MAX_FEED_BYTES and one more, with no length named. */
  | Readonly<{ kind: 'large'; bytes: number }>
  /** The fixed feed after MOCK_SLOW_MS. */
  | Readonly<{ kind: 'slow'; ms: number; body: string }>

const CALENDAR = { 'Content-Type': 'text/calendar; charset=utf-8' }

/**
 * The answer to a request for the calendar `id`, with its conditional
 * headers. Any id not listed in the design document gets the fixed feed,
 * or 304 when it asks with a validator.
 */
export function mockAnswer(
  id: string,
  conditions: Readonly<{
    ifNoneMatch: string | null
    ifModifiedSince: string | null
  }>,
): MockAnswer {
  const fixed = (
    status: number,
    headers: Record<string, string>,
    body: string | null = null,
  ): MockAnswer => ({ kind: 'fixed', status, headers, body })
  switch (id) {
    case 'cal-mockSlow':
      return { kind: 'slow', ms: MOCK_SLOW_MS, body: MOCK_FEED }
    case 'cal-mockLarge':
      return { kind: 'large', bytes: MAX_FEED_BYTES + 1 }
    case 'cal-mock429':
      return fixed(429, { 'Retry-After': '7200' })
    case 'cal-mock503':
      return fixed(503, { 'Retry-After': '3600' })
    case 'cal-mock500':
      return fixed(500, {})
    case 'cal-mockRedirect':
      return fixed(302, { Location: 'https://example.com/' })
    case 'cal-mockHtml':
      return fixed(
        200,
        { 'Content-Type': 'text/html' },
        '<!doctype html><title>Not a feed</title>',
      )
  }
  if (
    conditions.ifNoneMatch === MOCK_ETAG ||
    conditions.ifModifiedSince === MOCK_LAST_MODIFIED
  )
    return fixed(304, { ETag: MOCK_ETAG })
  return fixed(
    200,
    { ...CALENDAR, ETag: MOCK_ETAG, 'Last-Modified': MOCK_LAST_MODIFIED },
    MOCK_FEED,
  )
}
