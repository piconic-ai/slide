import type { BackupsFrameView } from '../operator/operations-backups-frame'
import { noticeOf, runbookLink } from '../alerts/notice'
import { notifierOf } from '../alerts/notify-routes'
import type { Notifier } from '../alerts/notifier'
import {
  commitPage,
  copyObject,
  expireCopies,
  finishRun,
  listSourcePage,
  readCounts,
  readState,
  readTracked,
  startPass,
} from './backup-store'
import {
  EXPIRE_BATCH,
  EXPIRE_COST,
  MAX_FAILURES_IN_PAGE,
  RUN_BUDGET,
  RUN_DEADLINE_MS,
  pageCost,
  pageLimit,
} from './limits'
import { planPage, type SourceObject } from './page-plan'
import { planRun, tellCount } from './run-plan'

/** What the run did, for the cron task's log line. */
export type BackupSummary = Readonly<{
  copied: number
  failed: number
  /** Copies deleted because their source had been gone for 30 days. */
  expired: number
}>

/** The parts of a run that a test sets; the cron task uses the defaults. */
export type BackupOptions = Readonly<{
  /** The calls to R2 and D1 one run may spend. */
  budget?: number
  /** The clock for the run's deadline, in milliseconds. */
  now?: () => number
  deadlineMs?: number
  /** The most copies one batch of a run deletes. */
  expireBatch?: number
  notify?: Notifier
}>

type Buckets = Readonly<{
  db: D1Database
  source: R2Bucket
  backup: R2Bucket
}>

type Tally = {
  copied: number
  failed: number
  expired: number
  /** Whether a page was recorded that moved the pass on or finished it. */
  advanced: boolean
}

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
 * Where the pass stands after a page: it stays when the page was given up,
 * moves on to the page's last key when there is more, and is complete
 * otherwise.
 */
function nextStep(givenUp: boolean, more: boolean, lastKey: string | null) {
  if (givenUp) return { kind: 'stay' } as const
  if (more && lastKey !== null) return { kind: 'cursor', key: lastKey } as const
  return { kind: 'complete' } as const
}

/**
 * Reads one page of the source from `cursor`, copies what the plan says and
 * records the page, with where the pass goes next, in one commit. It returns
 * the step taken and what the page cost.
 */
async function walkPage(
  buckets: Buckets,
  cursor: string | null,
  limit: number,
  at: number,
  tally: Tally,
) {
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
  const next = nextStep(done.givenUp, more, page.lastKey)
  await commitPage(buckets.db, {
    at,
    copied: done.copied,
    revive: done.givenUp ? [] : plan.revive,
    gone: done.givenUp ? [] : plan.gone,
    next,
  })
  return { next, cost: pageCost(plan.copy.length) }
}

/** What a firing may still spend: calls to R2 and D1, and time. */
type Spend = {
  remaining: number
  readonly now: () => number
  readonly deadline: number
}

const spendOf = (options: BackupOptions): Spend => {
  const now = options.now ?? Date.now
  return {
    remaining: options.budget ?? RUN_BUDGET,
    now,
    deadline: now() + (options.deadlineMs ?? RUN_DEADLINE_MS),
  }
}

/**
 * Goes through the source from `start`, a page at a time, until the end, the
 * budget or the deadline. Each page is recorded, with the cursor, before the
 * next is read, so a stop anywhere is picked up by the next run. The calls of
 * one deletion of expired copies are kept back for after the walk.
 */
async function walk(
  buckets: Buckets,
  start: string | null,
  at: number,
  spend: Spend,
  tally: Tally,
): Promise<void> {
  let cursor = start
  for (;;) {
    const limit = pageLimit(spend.remaining - EXPIRE_COST)
    if (limit === 0 || spend.now() > spend.deadline) return
    const { next, cost } = await walkPage(buckets, cursor, limit, at, tally)
    spend.remaining -= cost
    if (next.kind === 'stay') return
    tally.advanced = true
    if (next.kind === 'complete') return
    cursor = next.key
  }
}

/**
 * Runs one step of a run. An error stops that step and no other: it is
 * logged by its name only and counted as one failure, and the pass keeps the
 * place of its last recorded page, so the next run goes on from there.
 */
async function attempt(tally: Tally, step: () => Promise<void>) {
  try {
    await step()
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'backup_error',
        name: error instanceof Error ? error.name : 'unknown',
      }),
    )
    tally.failed += 1
  }
}

type ExpiryStores = Readonly<{ database: D1Database; backup: R2Bucket }>

/**
 * Deletes the expired copies, one batch after another, until none is left or
 * the calls or the time of the firing run out. The privacy policy states how
 * long a copy stays (article 8), so what is due is not left for a later day
 * while this firing can still delete it. The first batch is always tried:
 * the walk keeps its calls back.
 */
async function expireAll(
  stores: ExpiryStores,
  at: number,
  batch: number,
  spend: Spend,
  tally: Tally,
): Promise<void> {
  do {
    const gone = await expireCopies(stores, at, batch)
    spend.remaining -= EXPIRE_COST
    tally.expired += gone
    if (gone < batch) return
  } while (spend.remaining >= EXPIRE_COST && spend.now() <= spend.deadline)
}

/**
 * What a firing with no pass to run does: it deletes the expired copies, so
 * that they go at the next hour and do not wait for the day's pass. It
 * records nothing and tells nothing: it is not a run of the pass, and a
 * failure here is met again, and told, by the next one.
 */
async function expireLeftovers(
  stores: ExpiryStores,
  at: number,
  batch: number,
  spend: Spend,
): Promise<BackupSummary> {
  const tally: Tally = { copied: 0, failed: 0, expired: 0, advanced: false }
  await attempt(tally, () => expireAll(stores, at, batch, spend, tally))
  const { copied, failed, expired } = tally
  if (expired > 0)
    console.log(JSON.stringify({ event: 'backup', copied, failed, expired }))
  return { copied, failed, expired }
}

/**
 * The daily backup of the stored slide files (D-66), run at every firing of
 * the Cron Trigger. It starts the day's pass at its hour and, at any hour,
 * goes on with a pass that was not finished (D-67). Every firing, with a
 * pass to run or without, also deletes the copies whose source has been gone
 * for 30 days. A failure of a run of the pass is told in the next day's mail
 * (F39-AC31). Without the backup bucket it does nothing (D-08, F39-AC30).
 */
export async function runBackup(
  env: Env,
  at: number,
  options: BackupOptions = {},
): Promise<BackupSummary> {
  const none: BackupSummary = { copied: 0, failed: 0, expired: 0 }
  if (!env.UPLOADS_BACKUP) return none
  const buckets = {
    db: env.DB,
    source: env.UPLOADS,
    backup: env.UPLOADS_BACKUP,
  }
  const state = await readState(env.DB)
  const plan = planRun(state, at)
  const expireBatch = options.expireBatch ?? EXPIRE_BATCH
  const stores = { database: env.DB, backup: buckets.backup }
  const spend = spendOf(options)
  if (plan.kind === 'idle')
    return expireLeftovers(stores, at, expireBatch, spend)
  const tally: Tally = { ...none, advanced: false }
  await attempt(tally, async () => {
    if (plan.kind === 'start') await startPass(env.DB, at)
    const cursor = plan.kind === 'continue' ? plan.cursor : null
    await walk(buckets, cursor, at, spend, tally)
  })
  await attempt(tally, () => expireAll(stores, at, expireBatch, spend, tally))
  const count = tellCount(tally, state, at)
  await finishRun(env.DB, { at, failed: tally.failed, told: count !== null })
  if (count !== null)
    await (options.notify ?? notifierOf(env))(
      noticeOf('backup_failed', count, runbookLink('backup_failed')),
    )
  const { copied, failed, expired } = tally
  console.log(JSON.stringify({ event: 'backup', copied, failed, expired }))
  return { copied, failed, expired }
}

/**
 * What the frame "バックアップ" of the operations page shows (D-70): that the
 * bucket is not set up, or the records of the copy and how the last runs
 * went.
 */
export async function readBackupsFrame(
  env: Pick<Env, 'DB' | 'UPLOADS_BACKUP'>,
): Promise<BackupsFrameView> {
  if (!env.UPLOADS_BACKUP) return { kind: 'not_configured' }
  const state = await readState(env.DB)
  return {
    kind: 'ready',
    ...(await readCounts(env.DB, state.lastPassStartedAt)),
    passInProgress: state.pass.kind === 'in_progress',
    lastCompletedAt: state.lastCompletedAt,
    lastRunAt: state.lastRunAt,
    lastFailedAt: state.lastFailedAt,
    lastRunFailed: state.lastRunFailed,
  }
}
