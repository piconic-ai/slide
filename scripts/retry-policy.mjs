// Pure retry decisions for the upload CLI. Time and randomness are inputs.

/**
 * Parses SLIDE_RETRY_DELAY_MS, the base delay that also scales busy-start
 * waits. A missing value means one second; anything that is not a positive
 * finite number is refused, since it would disable or never end the waits.
 */
export function parseRetryDelay(value) {
  if (value === undefined || value === '') return 1000
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms <= 0)
    throw new Error('SLIDE_RETRY_DELAY_MS must be a positive number')
  return ms
}

/** Scales the busy-start policy by `baseMs`, its value at one second. */
export const scaledBusyStart = (baseMs) =>
  Object.fromEntries(
    Object.entries(BUSY_START).map(([key, ms]) => [key, (ms * baseMs) / 1000]),
  )

/** Transient failures: retried a few times with a short, growing wait. */
export const MAX_ATTEMPTS = 5

/**
 * Another upload for the same account holds the only active session. It ends
 * when that upload finishes, which can take minutes, so a busy start waits
 * longer than other transient failures before giving up.
 */
export const BUSY_START = {
  budgetMs: 300_000,
  firstWaitMs: 5_000,
  maxWaitMs: 30_000,
}

/**
 * Returns how long to wait before the next try, or null to stop.
 * `attempt` counts tries made so far (1 after the first failure).
 * `retryAfter` is the service's Retry-After in milliseconds, already capped.
 */
export function transientWait({ attempt, retryAfter, baseMs }) {
  if (attempt >= MAX_ATTEMPTS) return null
  return retryAfter ?? baseMs * attempt
}

/**
 * Wait for a busy start: doubles from `firstWaitMs` up to `maxWaitMs`, with
 * jitter so parallel jobs do not retry in lockstep: `random` in [0, 1)
 * shortens the backoff by up to half.
 * Stops once the next wait would end past the budget, measured from the first
 * start; a retry already under way for another error may still end past it.
 */
export function busyStartWait({
  attempt,
  elapsedMs,
  retryAfter,
  random,
  policy = BUSY_START,
}) {
  const backoff = Math.min(
    policy.firstWaitMs * 2 ** (attempt - 1),
    policy.maxWaitMs,
  )
  const wait = retryAfter ?? Math.round(backoff * (1 - random / 2))
  return elapsedMs + wait > policy.budgetMs ? null : wait
}
