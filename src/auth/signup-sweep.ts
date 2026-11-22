/** How long someone may leave a first sign-in unfinished before it is swept. */
export const STALE_SIGNUP_SECONDS = 24 * 60 * 60

/** A signed-up user, as the sweep sees them. Times are in seconds. */
export type SignupUser = Readonly<{
  id: string
  createdAt: number
  hasAccount: boolean
  /** Suspended people keep their id, so a suspension still finds them. */
  suspended: boolean
}>

/**
 * Whose records to delete: users who signed in but never made an account
 * (no handle chosen, no consent given), at least 24 hours after they were
 * created. Someone with an account is never swept, and neither is a
 * suspended person, whose id F17-AC30 keeps.
 */
export function staleSignups(
  users: readonly SignupUser[],
  now: number,
): string[] {
  return users
    .filter(
      (user) =>
        !user.hasAccount &&
        !user.suspended &&
        now - user.createdAt >= STALE_SIGNUP_SECONDS,
    )
    .map((user) => user.id)
}
