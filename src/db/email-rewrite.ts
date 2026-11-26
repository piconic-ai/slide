import { versionOfSealed } from './email-cipher'

/**
 * How many addresses one press of "書き換える" handles (D-84). A plain
 * address is a batch of two statements, so a press stays well inside the
 * limits of one request, and the operator presses again for the rest.
 */
export const REWRITE_LIMIT = 100

/** What one press did, and what is left. */
export type RewriteResult = Readonly<{
  /** Plain addresses (a user and an invitation together) now sealed. */
  sealed: number
  /** Rows sealed under an older key version, now under the current one. */
  resealed: number
  /** Rows left as they were, to be handled by the next press. */
  failed: number
  remaining: EmailCounts
}>

/** The rows of the two tables, by what state their address is in. */
export type EmailCounts = Readonly<{
  /** Still plain: what the operator rewrites down to 0 (F41-AC8). */
  plain: number
  /** Sealed under a key version other than the current one. */
  olderVersion: number
  /** Sealed under the current one. */
  current: number
}>

/** Whether a sealed text is under a version other than `current`. */
export const isOlderVersion = (sealed: string, current: number): boolean => {
  const version = versionOfSealed(sealed)
  return version !== null && version !== current
}

/** The work still to do: nothing when no row is plain or older. */
export const isDone = (counts: EmailCounts): boolean =>
  counts.plain === 0 && counts.olderVersion === 0
