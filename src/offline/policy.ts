import { OFFLINE_MAX_AGE_MS } from './limits'

/**
 * What a version's worker does with what the service answered (D-91 to D-93):
 * keep it, drop the stored copies, fall back on a stored copy, or just pass it on.
 */
export type FetchOutcome = 'store' | 'purge' | 'fallback' | 'pass'

export type AnswerFacts = Readonly<{
  status: number
  cacheControl: string | null
  /** `Response.type`: only a plain answer of this origin is kept. */
  type: string
  redirected: boolean
}>

/** Statuses by which the service says the version may not be shown: gone, hidden or not public. */
const WITHDRAWN = new Set([403, 404, 410])

/** Statuses by which the service is busy or down: a stored copy stands in. */
const isUnavailable = (status: number) => status === 429 || status >= 500

/**
 * An answer meant for one person (`private`) or for nobody's disk
 * (`no-store`), such as the author's own preview, is never kept.
 */
const keepable = (cacheControl: string | null) =>
  !/(^|[\s,])(private|no-store)(?=$|[\s,=])/i.test(cacheControl ?? '')

export function outcomeOf(answer: AnswerFacts): FetchOutcome {
  if (WITHDRAWN.has(answer.status)) return 'purge'
  if (isUnavailable(answer.status)) return 'fallback'
  if (
    answer.status === 200 &&
    answer.type === 'basic' &&
    !answer.redirected &&
    keepable(answer.cacheControl)
  )
    return 'store'
  return 'pass'
}

/**
 * Whether a copy fetched at `storedAt` may be shown at `now`. A time in the
 * future, or one that is not a number, is not a time anyone fetched at: no.
 * Exactly one day old is still shown.
 */
export function isFresh(storedAt: number, now: number): boolean {
  return (
    Number.isFinite(storedAt) &&
    storedAt <= now &&
    now - storedAt <= OFFLINE_MAX_AGE_MS
  )
}

/**
 * The policy of a stored shell, which the viewer's worker serves: the one
 * frame it may hold is the version's origin, and the one script is the
 * service's own. Built here from the origin, not taken from what was stored.
 */
export const shellPolicy = (versionOrigin: string) =>
  [
    "default-src 'none'",
    `frame-src ${versionOrigin}`,
    "script-src 'self'",
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
