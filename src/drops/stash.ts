/** How long a file picked before signing in is kept in the browser. */
export const STASH_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Where the script asks the visitor to sign in so the kept file is received. */
export const STASH_SIGN_IN_PATH = '/auth/github?to=top'

/**
 * A file kept in the browser while its owner signs in. `attempt` names the
 * upload it will become, so receiving it twice continues one upload.
 */
export type Stash<F> = Readonly<{
  file: F
  attempt: string
  /** When it was kept, in milliseconds since the epoch. */
  storedAt: number
}>

type FileLike = Readonly<{ name: string; size: number }>

const isFileLike = (value: unknown): value is FileLike =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as FileLike).name === 'string' &&
  Number.isFinite((value as FileLike).size) &&
  typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'

/**
 * What was read from the browser's storage as a kept file, or null when it
 * is not one or is too old to use. Storage is the visitor's own and may
 * hold anything: an older shape, a record another tab wrote halfway.
 */
export function freshStash<F extends FileLike>(
  record: unknown,
  now: number,
): Stash<F> | null {
  if (typeof record !== 'object' || record === null) return null
  const { file, attempt, storedAt } = record as Record<string, unknown>
  if (!isFileLike(file)) return null
  if (typeof attempt !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(attempt))
    return null
  if (typeof storedAt !== 'number' || !Number.isFinite(storedAt)) return null
  const age = now - storedAt
  // A clock set back makes a record look as if it were from the future.
  if (age < 0 || age >= STASH_MAX_AGE_MS) return null
  return { file: file as F, attempt, storedAt }
}

/**
 * Where, in the tab's own storage, pressing "sign in to continue" leaves the
 * attempt of the kept file, for the page the sign-in comes back to.
 */
export const STASH_CONTINUE_KEY = 'slide-drop-continue'

/**
 * Whether a signed-in visitor on the top page is the one who pressed "sign
 * in to continue" for this kept file, in this tab, and has just come back.
 * Only then is the file received by itself. A file someone else kept in the
 * same browser, or one its owner walked away from, is not sent in the name
 * of whoever happens to be signed in.
 */
export function isContinuing(
  mark: string | null | undefined,
  kept: Readonly<{ attempt: string }> | null,
): boolean {
  return kept !== null && typeof mark === 'string' && mark === kept.attempt
}
