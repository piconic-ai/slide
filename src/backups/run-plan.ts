import { MIN_PASS_GAP_SECONDS, START_HOUR_UTC } from './limits'

/** A pass over the source bucket: none under way, or one that has a place. */
export type PassState =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{
      kind: 'in_progress'
      startedAt: number
      /** The last source key the pass has finished with; null before its first page. */
      cursor: string | null
    }>

/** Where the copy has got to, as `backup_state` records it. */
export type BackupState = Readonly<{
  pass: PassState
  lastPassStartedAt: number | null
  lastCompletedAt: number | null
  progressAt: number | null
  lastRunAt: number | null
  lastRunFailed: number
  lastFailedAt: number | null
  toldAt: number | null
}>

/** The columns of `backup_state`, before they are checked. */
export type BackupStateRow = Readonly<{
  pass_started_at: number | null
  cursor: string | null
  last_pass_started_at: number | null
  last_completed_at: number | null
  progress_at: number | null
  last_run_at: number | null
  last_run_failed: number
  last_failed_at: number | null
  told_at: number | null
}>

/**
 * The state a stored row means. A cursor without a pass is a contradiction
 * the table forbids (a CHECK); it throws rather than being read as idle,
 * since a row that breaks its own rule was not written by this code.
 */
export function parseState(row: BackupStateRow): BackupState {
  if (row.pass_started_at === null && row.cursor !== null)
    throw new RangeError('A backup cursor needs a pass in progress')
  return {
    pass:
      row.pass_started_at === null
        ? { kind: 'idle' }
        : {
            kind: 'in_progress',
            startedAt: row.pass_started_at,
            cursor: row.cursor,
          },
    lastPassStartedAt: row.last_pass_started_at,
    lastCompletedAt: row.last_completed_at,
    progressAt: row.progress_at,
    lastRunAt: row.last_run_at,
    lastRunFailed: row.last_run_failed,
    lastFailedAt: row.last_failed_at,
    toldAt: row.told_at,
  }
}

/** What a firing of the cron task does. */
export type RunPlan =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'start' }>
  | Readonly<{ kind: 'continue'; startedAt: number; cursor: string | null }>

/**
 * Whether this firing starts the day's pass, goes on with one that was not
 * finished, or does nothing. The task is hourly, as the service's one Cron
 * Trigger is: a pass in progress goes on at every firing (D-67), so a bucket
 * too big for one run is done in a few hours; a new one starts at the firing
 * of its hour, or at the first firing there ever is.
 */
export function planRun(state: BackupState, at: number): RunPlan {
  if (state.pass.kind === 'in_progress')
    return {
      kind: 'continue',
      startedAt: state.pass.startedAt,
      cursor: state.pass.cursor,
    }
  if (state.lastPassStartedAt === null) return { kind: 'start' }
  const hour = new Date(at * 1000).getUTCHours()
  return hour === START_HOUR_UTC &&
    at - state.lastPassStartedAt >= MIN_PASS_GAP_SECONDS
    ? { kind: 'start' }
    : { kind: 'idle' }
}
