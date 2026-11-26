// The rule of the one-at-a-time lease on making a person's zip (D-36). Pure.

/**
 * How long a lease holds if it is never given back (a Worker that was
 * stopped cannot say it is done). A zip is released when its stream ends,
 * fails or is cancelled, which is what ends nearly every lease; this is the
 * time after which a lost one stops blocking.
 */
export const LEASE_SECONDS = 5 * 60

/** The R2 key of a person's lease, or null for an ID that is not plain. */
export function leaseKey(userId: string): string | null {
  return /^[A-Za-z0-9_-]{1,128}$/.test(userId)
    ? `exports/leases/${userId}`
    : null
}

/** What a lease found on the key means now. */
export type LeaseHolding =
  | Readonly<{ kind: 'held'; retryAfter: number }>
  | Readonly<{ kind: 'lapsed' }>

/** Whether a lease that holds until `until` still holds at `now` (seconds). */
export function holdingOf(until: unknown, now: number): LeaseHolding {
  const seconds = typeof until === 'string' ? Number(until) : Number.NaN
  // A lease that cannot be read is treated as lapsed, so one damaged
  // object never locks a person out for good.
  if (!Number.isFinite(seconds) || seconds <= now) return { kind: 'lapsed' }
  return {
    kind: 'held',
    retryAfter: Math.min(Math.ceil(seconds - now), LEASE_SECONDS),
  }
}
