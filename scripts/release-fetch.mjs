// `fetch` with a time limit, for the release scripts. The pure modules take a
// `send` and set no timer themselves (a pure test must not depend on one), so
// the commands wrap the platform's `fetch` here: a check is cut off after 15
// seconds and a notice after 5, and each rejects with a `TimeoutError`.

/** The limit of one check request, in milliseconds. */
export const CHECK_TIMEOUT_MS = 15_000
/** The limit of one Discord post, in milliseconds. */
export const NOTICE_TIMEOUT_MS = 5_000

/** `send` that gives up after `ms`, whatever the caller asked for. */
export const limitTime = (send, ms) => (url, init) =>
  send(url, { ...init, signal: AbortSignal.timeout(ms) })
