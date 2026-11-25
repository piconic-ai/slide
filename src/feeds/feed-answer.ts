/**
 * What one request for a feed asks and what its answer means (D-64, D-65,
 * D-67), apart from sending it.
 */
import { FEED_USER_AGENT } from './limits'

/** Why reading a feed failed; kept with the feed and shown to operators. */
export const FEED_FAILURES = [
  /** The address is not a calendar's feed, so nothing was asked (D-67). */
  'refused',
  /** Luma answered with a redirect, which is not followed (D-67). */
  'redirect',
  /** Any other answer than 200 or 304, 429 and 503 aside. */
  'http_error',
  /** 429 (D-65). */
  'rate_limited',
  /** 503 (D-65). */
  'unavailable',
  /** The answer was longer than MAX_FEED_BYTES (D-64). */
  'too_large',
  /** The answer took longer than FEED_TIMEOUT_MS (D-64). */
  'timeout',
  /** The request did not reach Luma or its answer broke off. */
  'network',
  /** The answer was not an iCal calendar. */
  'not_calendar',
  /**
   * The read stopped before its outcome was written (the Worker was cut
   * off, or an error was thrown); written when the read starts.
   */
  'interrupted',
] as const
export type FeedFailure = (typeof FEED_FAILURES)[number]

/** The validators of the last full answer (D-64). */
export type Validators = Readonly<{
  etag: string | null
  lastModified: string | null
}>

/** What one request for a feed came to. */
export type FeedAnswer =
  | Readonly<{ kind: 'full'; body: string; validators: Validators }>
  | Readonly<{ kind: 'not_modified'; validators: Validators }>
  | Readonly<{
      kind: 'failed'
      reason: FeedFailure
      /** The Retry-After of a 429 or a 503, as it was sent. */
      retryAfter: string | null
    }>

/**
 * The headers of a request: the bot's User-Agent (D-66), and the validators
 * of the last full answer, so an unchanged feed answers 304 (D-64).
 */
export function feedRequestHeaders(
  validators: Validators,
): Record<string, string> {
  return {
    'User-Agent': FEED_USER_AGENT,
    Accept: 'text/calendar',
    ...(validators.etag === null ? {} : { 'If-None-Match': validators.etag }),
    ...(validators.lastModified === null
      ? {}
      : { 'If-Modified-Since': validators.lastModified }),
  }
}

// Validators longer than the record keeps are not kept, and the next request
// goes without them.
const MAX_ETAG = 256
const MAX_LAST_MODIFIED = 64
const kept = (value: string | null, max: number) =>
  value !== null && value.length >= 1 && value.length <= max ? value : null

/** The validators of an answer, as far as they can be kept. */
export const validatorsOf = (headers: Headers): Validators => ({
  etag: kept(headers.get('ETag'), MAX_ETAG),
  lastModified: kept(headers.get('Last-Modified'), MAX_LAST_MODIFIED),
})

/**
 * What the status of an answer means before its body is read: `read` for a
 * 200 whose body is to be read, else the whole answer. A 304 keeps the
 * validators sent, unless it names new ones.
 */
export function answerOfStatus(
  status: number,
  headers: Headers,
  sent: Validators,
): Readonly<{ kind: 'read' }> | FeedAnswer {
  if (status === 200) return { kind: 'read' }
  if (status === 304) {
    const named = validatorsOf(headers)
    return {
      kind: 'not_modified',
      validators: {
        etag: named.etag ?? sent.etag,
        lastModified: named.lastModified ?? sent.lastModified,
      },
    }
  }
  const failed = (reason: FeedFailure, retryAfter: string | null = null) =>
    ({ kind: 'failed', reason, retryAfter }) as const
  if (status >= 300 && status < 400) return failed('redirect')
  if (status === 429) return failed('rate_limited', headers.get('Retry-After'))
  if (status === 503) return failed('unavailable', headers.get('Retry-After'))
  return failed('http_error')
}

/** Whether a declared Content-Length is already past the limit. */
export function declaredTooLarge(headers: Headers, max: number): boolean {
  const length = headers.get('Content-Length')
  return length !== null && /^\d+$/u.test(length) && Number(length) > max
}
