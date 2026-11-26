// What one run of the backup may do, and when it runs (docs/dev/backup.md).
// Constants and arithmetic only: nothing here reads the clock or a bucket.

/**
 * How long a copy whose source is gone stays in the backup (D-66), counted
 * from the pass that found the source gone.
 */
export const RETENTION_SECONDS = 30 * 24 * 60 * 60

/**
 * The time before which a copy's source must have been found gone for the
 * copy to be deleted: strictly more than 30 days after (F39-AC27, F39-AC28).
 */
export const expiryCutoff = (at: number) => at - RETENTION_SECONDS

/** The hour (UTC) at which the day's pass starts; Japan is nine hours ahead. */
export const START_HOUR_UTC = 18

/**
 * The pass starts at most this often, so that a second firing in its hour
 * (a manual one, a late one) does not start another.
 */
export const MIN_PASS_GAP_SECONDS = 12 * 60 * 60

/**
 * What one run may spend, in calls to R2 and D1. Each is a subrequest, and a
 * Worker may make 10,000 on the paid plan and 1,000 to internal services
 * otherwise (https://developers.cloudflare.com/workers/platform/limits/,
 * read 2026-11-26), so a run stays under the smaller.
 */
export const RUN_BUDGET = 900

/** The calls a page always costs: the listing, the rows read, the rows written. */
export const PAGE_COST = 3

/** The calls a copy costs: the read of the source and the write to the backup. */
export const COPY_COST = 2

/**
 * The most objects one page lists, so that the batch that records it stays a
 * few hundred statements.
 */
export const PAGE_MAX = 400

/** A page that has this many failed copies is given up, and so is the run. */
export const MAX_FAILURES_IN_PAGE = 5

/** A run stops starting pages after this long, in milliseconds. */
export const RUN_DEADLINE_MS = 10 * 60 * 1000

/** The most copies that are deleted in one run. */
export const EXPIRE_BATCH = 500

/** What deleting expired copies costs: the rows read, the copies, the rows. */
export const EXPIRE_COST = 3

/** A pass that has moved on by nothing for this many days is told as stalled. */
export const STALL_DAYS = 2

/** A failure that goes on is told again after this long, not every hour. */
export const TELL_AGAIN_SECONDS = 20 * 60 * 60

/**
 * How many objects the next page may list: as many as the calls left can
 * copy if every one of them is new, so a page never overspends, and no more
 * than `PAGE_MAX`. 0 means there is not enough left for a page.
 */
export function pageLimit(remaining: number): number {
  if (!Number.isFinite(remaining)) return 0
  const affordable = Math.floor((remaining - PAGE_COST) / COPY_COST)
  return Math.max(0, Math.min(PAGE_MAX, affordable))
}

/** What a page spent: its fixed calls and two for each copy it tried. */
export const pageCost = (copies: number) => PAGE_COST + COPY_COST * copies
