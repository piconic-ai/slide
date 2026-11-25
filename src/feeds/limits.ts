/**
 * How the service treats Luma when it reads calendars' feeds
 * (docs/dev/f33-luma-feeds.md, D-61 to D-67). Fixed: none of them comes
 * from the settings.
 */

/** The User-Agent of every request to Luma (D-66). */
export const FEED_USER_AGENT =
  'slide.community-bot/1.0 (+https://slide.community/help/bot)'

/** The largest answer read, in bytes; a longer one is cut off (D-64). */
export const MAX_FEED_BYTES = 2 * 1024 * 1024

/** How long one request may take, body included, in milliseconds (D-64). */
export const FEED_TIMEOUT_MS = 10_000

/** No feed is asked for twice within this many seconds (D-62). */
export const MIN_READ_INTERVAL = 60 * 60

/** Each feed is read once in this many seconds (D-61). */
export const READ_EVERY = 24 * 60 * 60

/** The longest wait after a failure, in seconds (D-65). */
export const MAX_BACKOFF = 24 * 60 * 60

/** Failures in a row after which a feed is no longer read (D-65). */
export const MAX_FAILURES = 5

/** Requests to Luma a minute, at most (D-63). */
export const FEEDS_PER_MINUTE = 10

/** The time between the starts of two requests, in milliseconds (D-63). */
export const FEED_SPACING_MS = 60_000 / FEEDS_PER_MINUTE

/**
 * How long one request holds the gate, in milliseconds: longer than it may
 * take, so a reader that dies lets the next one in by itself.
 */
export const FEED_LEASE_MS = 3 * FEED_TIMEOUT_MS

/** The most event addresses one feed is read for. */
export const MAX_FEED_EVENTS = 2000
