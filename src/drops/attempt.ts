import type { PlannedFile } from './plan'
import type { SendResult } from './send'

/** The attempt a drop that did not finish was sent under, and what it sent. */
export type Remembered = Readonly<{ key: string; attempt: string }>

/**
 * Names what a plan sends: its paths with the checksum of each. Two drops of
 * the same content have the same key, whatever the dropped file is called.
 */
export function planKey(files: readonly PlannedFile[]): string {
  // Pairs, not joined text: a path may hold any character a join would use.
  return JSON.stringify(
    files
      .map(({ path, sha256 }) => [path, sha256] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
}

/**
 * The attempt to send a drop under. The same content dropped again after an
 * upload that did not finish goes on under the attempt it had, so the
 * service continues that upload instead of making a second slide. Anything
 * else is a new attempt.
 */
export function attemptFor(
  remembered: Remembered | null,
  key: string,
  fresh: () => string,
): string {
  return remembered?.key === key ? remembered.attempt : fresh()
}

/** What to remember after a send: the attempt, while it can still go on. */
export function rememberAfter(
  result: SendResult,
  key: string,
  attempt: string,
): Remembered | null {
  return !result.ok && result.resumable ? { key, attempt } : null
}
