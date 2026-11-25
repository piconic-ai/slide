/** How long a file picked before signing in is kept in the browser. */
export const STASH_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Where the script asks the visitor to sign in so the kept file is received. */
export const STASH_SIGN_IN_PATH = '/login?to=top'

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
 * Where, in the tab's own storage, pressing "sign in to continue" leaves its
 * mark, for the page the sign-in comes back to.
 */
export const STASH_CONTINUE_KEY = 'slide-drop-continue'

/** How long after "sign in to continue" a return still receives the file. */
export const STASH_CONTINUE_MAX_AGE_MS = 10 * 60 * 1000

/** The query the sign-in carries the mark's token in, there and back. */
export const STASH_RETURN_PARAM = 'drop'

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/

/** Whether a value can be the token of one press of "sign in to continue". */
export const isStashToken = (value: unknown): value is string =>
  typeof value === 'string' && TOKEN.test(value)

/** Where one press of "sign in to continue" goes, carrying its token. */
export const stashSignInPath = (token: string): string =>
  `${STASH_SIGN_IN_PATH}&${STASH_RETURN_PARAM}=${token}`

/** Where a sign-in for a kept file lands: the top page, with its token. */
export const stashLanding = (token: unknown): string =>
  isStashToken(token) ? `/?${STASH_RETURN_PARAM}=${token}` : '/'

/**
 * The mark one press of "sign in to continue" leaves: which kept file, the
 * token this sign-in carries, and when.
 */
export const continueMark = (
  attempt: string,
  token: string,
  now: number,
): string => JSON.stringify({ attempt, token, at: now })

/**
 * Whether a signed-in visitor on the top page is the one who pressed "sign
 * in to continue" for this kept file, in this tab, and has just come back
 * from that sign-in. Only then is the file received by itself: the mark
 * names this file, the page was reached with the mark's own token, which
 * only that sign-in returns with, and the press was a short while ago. A
 * file someone else kept in the same browser, or one whose owner walked
 * away from the login page, is not sent in the name of whoever is signed in.
 */
export function isContinuing(
  mark: string | null | undefined,
  kept: Readonly<{ attempt: string }> | null,
  returned: string | null | undefined,
  now: number,
): boolean {
  if (kept === null || typeof mark !== 'string') return false
  let left: unknown
  try {
    left = JSON.parse(mark)
  } catch {
    return false
  }
  if (typeof left !== 'object' || left === null) return false
  const { attempt, token, at } = left as Record<string, unknown>
  if (attempt !== kept.attempt) return false
  if (!isStashToken(token) || token !== returned) return false
  if (typeof at !== 'number' || !Number.isFinite(at)) return false
  const age = now - at
  return age >= 0 && age < STASH_CONTINUE_MAX_AGE_MS
}
