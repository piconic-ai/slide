/**
 * When a feed may and should be read, and what one read makes of its record
 * (D-61, D-62, D-64, D-65). Times are in seconds.
 */
import type { FeedAnswer, FeedFailure, Validators } from './feed-answer'
import {
  MAX_BACKOFF,
  MAX_FAILURES,
  MAX_RETRY_AFTER,
  MIN_READ_INTERVAL,
  READ_EVERY,
  READ_SLACK,
} from './limits'

/** Whether a feed is read, or stopped until an operator resumes it. */
export type FeedState =
  | Readonly<{ kind: 'active'; lastFailure: FeedFailure | null }>
  | Readonly<{ kind: 'stopped'; at: number; reason: FeedFailure }>

/** What the service keeps of one feed; nothing of what it lists (D-60). */
export type FeedRecord = Readonly<{
  url: string
  /** When the feed was last asked for; null before the first time. */
  readAt: number | null
  /** The feed is not asked for before this. */
  notBefore: number
  /** When the feed is next to be read. */
  dueAt: number
  /** The time a Retry-After named, kept across a resume. */
  retryUntil: number | null
  validators: Validators
  /** Failures in a row. */
  failures: number
  state: FeedState
}>

/** A feed never read: due at once. */
export const newFeedRecord = (url: string): FeedRecord => ({
  url,
  readAt: null,
  notBefore: 0,
  dueAt: 0,
  retryUntil: null,
  validators: { etag: null, lastModified: null },
  failures: 0,
  state: { kind: 'active', lastFailure: null },
})

/** Whether the feed is to be asked for now. */
export const isReadable = (record: FeedRecord, now: number) =>
  record.state.kind === 'active' &&
  record.dueAt <= now &&
  record.notBefore <= now

/**
 * The record as the feed is asked for: no other request for it within the
 * hour, whoever asks (D-62).
 */
export const claimedRecord = (record: FeedRecord, now: number): FeedRecord => ({
  ...record,
  readAt: now,
  notBefore: now + MIN_READ_INTERVAL,
})

/** The wait after the n-th failure in a row: an hour, doubled each time, at most a day. */
export const backoffAfter = (failures: number) =>
  Math.min(MAX_BACKOFF, MIN_READ_INTERVAL * 2 ** Math.max(0, failures - 1))

const HTTP_DATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/u

/**
 * The time a Retry-After names (RFC 9110 10.2.3): seconds from now, or an
 * HTTP date. Null when it names none, a time already past, or one more than
 * MAX_RETRY_AFTER away: such a failure waits as any other.
 */
export function retryAfterAt(value: string | null, now: number): number | null {
  const text = value?.trim() ?? ''
  const within = (at: number) =>
    Number.isFinite(at) && at > now && at - now <= MAX_RETRY_AFTER ? at : null
  if (/^\d{1,10}$/u.test(text)) return within(now + Number(text))
  if (!HTTP_DATE.test(text)) return null
  return within(Math.ceil(new Date(text).getTime() / 1000))
}

/**
 * The record after a read that started at `record.readAt` (or now) and ended
 * now. A success clears the failures and is next due a day later. A failure
 * waits longer each time and never less than a Retry-After asks; the fifth
 * in a row stops the feed (D-65). A 304 keeps the validators (D-64).
 */
export function recordAfter(
  record: FeedRecord,
  outcome: FeedAnswer,
  now: number,
): FeedRecord {
  const startedAt = record.readAt ?? now
  if (outcome.kind !== 'failed')
    return {
      ...record,
      readAt: startedAt,
      notBefore: startedAt + MIN_READ_INTERVAL,
      dueAt: startedAt + READ_EVERY - READ_SLACK,
      retryUntil: null,
      validators: outcome.validators,
      failures: 0,
      state: { kind: 'active', lastFailure: null },
    }
  const failures = record.failures + 1
  const retryUntil =
    outcome.reason === 'rate_limited' || outcome.reason === 'unavailable'
      ? retryAfterAt(outcome.retryAfter, now)
      : null
  const notBefore = Math.max(
    now + backoffAfter(failures),
    startedAt + MIN_READ_INTERVAL,
    retryUntil ?? 0,
  )
  return {
    ...record,
    readAt: startedAt,
    notBefore,
    dueAt: notBefore,
    retryUntil,
    failures,
    state:
      failures >= MAX_FAILURES
        ? { kind: 'stopped', at: now, reason: outcome.reason }
        : { kind: 'active', lastFailure: outcome.reason },
  }
}

/**
 * The record after an operator resumes a stopped feed: read again soon,
 * but not within the hour of the last request. A Retry-After is let go:
 * the operator decided (at most MAX_RETRY_AFTER is ever kept).
 */
export function resumedRecord(record: FeedRecord, now: number): FeedRecord {
  return {
    ...record,
    notBefore: Math.max(now, (record.readAt ?? 0) + MIN_READ_INTERVAL),
    retryUntil: null,
    dueAt: now,
    failures: 0,
    state: { kind: 'active', lastFailure: null },
  }
}

/** The record after an early read is asked for (D-61): due now, the hour kept (D-62). */
export const requestedRecord = (
  record: FeedRecord,
  now: number,
): FeedRecord => ({ ...record, dueAt: Math.min(record.dueAt, now) })
