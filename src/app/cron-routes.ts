import { sweepSignups } from '../auth/signup-store'
import { readFeedsOnSchedule } from '../feeds/reader-routes'
import { sweepPreviews } from '../preview/store'
import { purgeDelaySeconds, purgeDeletedDecks } from '../decks/deletion-store'
import { describeCleanupError } from '../uploads/cleanup'
import { runUploadCleanup } from '../uploads/cleanup-store'
import { parseUploadLimits } from '../uploads/limits'
import { isMaintenance } from '../site/error-pages'
import {
  dailyTask as daily,
  dueTasks,
  hourlyTask as hourly,
  registerTasks,
  type CronTask,
} from './cron-task'

/**
 * Everything the Cron Trigger does, by name. The service has one Cron
 * Trigger, hourly; a task that should run once a day is a `daily` task and
 * runs at the firing of its hour (UTC). Do not add another Cron Trigger.
 *
 * To add a task, add one line. Give it a snake_case name: its log events are
 * that name when it works and `<name>_error` when it fails, and a task with
 * no line for success passes `{ logsSuccess: false }`. A daily task names an
 * hour no other daily task uses, so that one firing does not do them all. The
 * hours agreed so far (UTC; Japan is nine hours ahead): the backup at 18, the
 * D1 size at 19, the copy of the metrics at 20, the next-day mail at 23.
 * `run` answers a summary, which is logged with the event.
 */
export const CRON_TASKS = registerTasks([
  hourly('preview_sweep', (env, at) => sweepPreviews(env.DB, at), {
    logsSuccess: false,
  }),
  hourly('signup_sweep', (env, at) => sweepSignups(env.DB, at)),
  hourly('upload_cleanup', (env, at) => runUploadCleanup(env, at), {
    errorFields: describeCleanupError,
  }),
  hourly(
    'deck_purge',
    (env, at) =>
      purgeDeletedDecks(
        env,
        at,
        purgeDelaySeconds(parseUploadLimits(env.UPLOAD_LIMITS)),
      ),
    { errorFields: describeCleanupError },
  ),
  // Luma calendars' feeds, each once a day (F33-AC14): a feed is due a day
  // after its last read, so this reads only the feeds that are due.
  hourly('feeds_read', (env) => readFeedsOnSchedule(env)),
])

/**
 * Runs one task and logs how it went. A failure, including one thrown before
 * the task's first await, is logged and goes no further, so no task stops
 * another.
 */
export function runCronTask(task: CronTask, env: Env, at: number) {
  return (async () => task.run(env, at))().then(
    (summary) => {
      if (task.logs.done !== null)
        console.log(
          JSON.stringify({
            event: task.logs.done,
            ...(typeof summary === 'object' ? summary : {}),
          }),
        )
    },
    (error: unknown) =>
      console.error(
        JSON.stringify({
          event: task.logs.failed,
          ...task.errorFields(error),
        }),
      ),
  )
}

/**
 * The Cron Trigger's handler over a list of tasks: those due at this firing
 * are all started at once, each held by `waitUntil`.
 */
export function runScheduled(
  tasks: readonly CronTask[],
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
) {
  // Tasks write D1 and R2, so they wait while maintenance holds the data.
  if (isMaintenance(env.MAINTENANCE)) {
    console.log(JSON.stringify({ event: 'scheduled_skipped_maintenance' }))
    return
  }
  const at = Math.floor(event.scheduledTime / 1000)
  for (const task of dueTasks(tasks, event.scheduledTime))
    ctx.waitUntil(runCronTask(task, env, at))
}
