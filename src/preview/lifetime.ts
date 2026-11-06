/** How long an issued launch token can be consumed. */
export const LAUNCH_SECONDS = 60
/** A viewing session ends after this long without a request. */
export const SESSION_IDLE_SECONDS = 2 * 60 * 60
/** A viewing session never outlives this, however active. */
export const SESSION_HARD_SECONDS = 12 * 60 * 60

export type SessionTimes = Readonly<{
  createdAt: number
  expiresAt: number
  hardExpiresAt: number
}>

export function newSessionTimes(now: number): SessionTimes {
  return {
    createdAt: now,
    expiresAt: now + SESSION_IDLE_SECONDS,
    hardExpiresAt: now + SESSION_HARD_SECONDS,
  }
}

/**
 * The extended expiry for a session used at `now`, or null when it need not
 * be written yet. Renewing only past half the idle window keeps a deck's
 * many asset requests from each writing to D1.
 */
export function renewedExpiry(
  session: Pick<SessionTimes, 'expiresAt' | 'hardExpiresAt'>,
  now: number,
): number | null {
  if (now >= session.expiresAt) return null
  if (session.expiresAt - now > SESSION_IDLE_SECONDS / 2) return null
  const next = Math.min(now + SESSION_IDLE_SECONDS, session.hardExpiresAt)
  return next > session.expiresAt ? next : null
}
