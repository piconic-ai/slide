/** How long someone may leave a first sign-in unfinished before it is swept. */
export const STALE_SIGNUP_SECONDS = 24 * 60 * 60

/** The most people one hourly run deletes; the rest wait for the next. */
export const SWEEP_LIMIT = 100

/** A signed-up user, as the sweep sees them. Times are in seconds. */
export type SignupUser = Readonly<{
  id: string
  /** The latest of when they were made and when a session of theirs began. */
  lastSignInAt: number
  hasAccount: boolean
  /** Suspended people keep their id, so a suspension still finds them. */
  suspended: boolean
}>

/**
 * Whose records to delete: users who signed in but never made an account
 * (no handle chosen, no consent given), at least 24 hours after their last
 * sign-in. The clock restarts at each sign-in, so someone who signed in again
 * and is filling in the welcome page is not swept under their hands. Someone
 * with an account is never swept, and neither is a suspended person, whose
 * id F17-AC30 keeps. At most `limit` are chosen, the longest idle first.
 */
export function staleSignups(
  users: readonly SignupUser[],
  now: number,
  limit: number = SWEEP_LIMIT,
): string[] {
  return users
    .filter(
      (user) =>
        !user.hasAccount &&
        !user.suspended &&
        now - user.lastSignInAt >= STALE_SIGNUP_SECONDS,
    )
    .sort((a, b) => a.lastSignInAt - b.lastSignInAt)
    .slice(0, limit)
    .map((user) => user.id)
}
