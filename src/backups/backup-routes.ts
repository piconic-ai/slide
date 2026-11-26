import {
  commitPage,
  copyObject,
  finishRun,
  listSourcePage,
  readState,
  readTracked,
  startPass,
} from './backup-store'
import {
  MAX_FAILURES_IN_PAGE,
  RUN_BUDGET,
  RUN_DEADLINE_MS,
  pageCost,
  pageLimit,
} from './limits'
import { planPage, type SourceObject } from './page-plan'
import { planRun } from './run-plan'

/** What the run did, for the cron task's log line. */
export type BackupSummary = Readonly<{ copied: number; failed: number }>

/** The parts of a run that a test sets; the cron task uses the defaults. */
export type BackupOptions = Readonly<{
  /** The calls to R2 and D1 one run may spend. */
  budget?: number
  /** The clock for the run's deadline, in milliseconds. */
  now?: () => number
  deadlineMs?: number
}>

type Buckets = Readonly<{
  db: D1Database
  source: R2Bucket
  backup: R2Bucket
}>

type Tally = { copied: number; failed: number }

/**
 * Copies the objects of a page one after another. A copy that throws is
 * counted and the page goes on; the page is given up after
 * `MAX_FAILURES_IN_PAGE` failures, so that a bucket that is down is not
 * asked for every object. `changed` objects (put again since they were
 * listed) are left for the next pass and are not failures.
 */
async function copyPage(
  { source, backup }: Buckets,
  objects: readonly SourceObject[],
) {
  const copied: SourceObject[] = []
  let failed = 0
  for (const object of objects) {
    if (failed >= MAX_FAILURES_IN_PAGE) break
    try {
      if ((await copyObject(source, backup, object)) === 'copied')
        copied.push(object)
    } catch {
      failed += 1
    }
  }
  return { copied, failed, givenUp: failed >= MAX_FAILURES_IN_PAGE }
}

/**
 * Goes through the source from `cursor`, a page at a time, until the end,
 * the budget or the deadline. Each page is recorded, with the cursor, before
 * the next is read, so a stop anywhere is picked up by the next run.
 */
async function walk(
  buckets: Buckets,
  start: string | null,
  at: number,
  options: BackupOptions,
  tally: Tally,
): Promise<void> {
  const now = options.now ?? Date.now
  const deadline = now() + (options.deadlineMs ?? RUN_DEADLINE_MS)
  let remaining = options.budget ?? RUN_BUDGET
  let cursor = start
  for (;;) {
    const limit = pageLimit(remaining)
    if (limit === 0 || now() > deadline) return
    const page = await listSourcePage(buckets.source, cursor, limit)
    const more = page.truncated && page.lastKey !== null
    const tracked = await readTracked(
      buckets.db,
      cursor,
      more ? page.lastKey : null,
    )
    const plan = planPage(page.objects, tracked)
    const done = await copyPage(buckets, plan.copy)
    tally.copied += done.copied.length
    tally.failed += done.failed
    remaining -= pageCost(plan.copy.length)
    const next = done.givenUp
      ? ({ kind: 'stay' } as const)
      : more
        ? ({ kind: 'cursor', key: page.lastKey } as const)
        : ({ kind: 'complete' } as const)
    await commitPage(buckets.db, {
      at,
      copied: done.copied,
      revive: done.givenUp ? [] : plan.revive,
      gone: done.givenUp ? [] : plan.gone,
      next,
    })
    if (next.kind !== 'cursor') return
    cursor = next.key
  }
}

/**
 * The daily backup of the stored slide files (D-66), run at every firing of
 * the Cron Trigger. It starts the day's pass at its hour and, at any hour,
 * goes on with a pass that was not finished (D-67). Without the backup bucket
 * it does nothing (D-08, F39-AC30).
 */
export async function runBackup(
  env: Pick<Env, 'DB' | 'UPLOADS' | 'UPLOADS_BACKUP'>,
  at: number,
  options: BackupOptions = {},
): Promise<BackupSummary> {
  const idle: BackupSummary = { copied: 0, failed: 0 }
  if (!env.UPLOADS_BACKUP) return idle
  const buckets = {
    db: env.DB,
    source: env.UPLOADS,
    backup: env.UPLOADS_BACKUP,
  }
  const plan = planRun(await readState(env.DB), at)
  if (plan.kind === 'idle') return idle
  const tally: Tally = { copied: 0, failed: 0 }
  try {
    if (plan.kind === 'start') await startPass(env.DB, at)
    const cursor = plan.kind === 'continue' ? plan.cursor : null
    await walk(buckets, cursor, at, options, tally)
  } catch (error) {
    // The pass keeps the place of its last recorded page, so the next run
    // goes on from there. Only the error's name is logged.
    console.error(
      JSON.stringify({
        event: 'backup_error',
        name: error instanceof Error ? error.name : 'unknown',
      }),
    )
    tally.failed += 1
  }
  await finishRun(env.DB, { at, failed: tally.failed })
  console.log(JSON.stringify({ event: 'backup', ...tally }))
  return tally
}
