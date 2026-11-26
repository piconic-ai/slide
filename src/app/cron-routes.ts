import { sweepSignups } from '../auth/signup-store'
import { readFeedsOnSchedule } from '../feeds/reader-routes'
import { sweepPreviews } from '../preview/store'
import { purgeDelaySeconds, purgeDeletedDecks } from '../decks/deletion-store'
import { describeCleanupError } from '../uploads/cleanup'
import { runUploadCleanup } from '../uploads/cleanup-store'
import { parseUploadLimits } from '../uploads/limits'
import { isMaintenance } from '../site/error-pages'
import { runBackup } from '../backups/backup-routes'
import { cronFailedNotice, runbookLink } from '../alerts/notice'
import { collectDaily, measureD1 } from '../alerts/daily-routes'
import { sendDigest } from '../alerts/digest-routes'
import { notifierOf } from '../alerts/notify-routes'
import type { Notifier } from '../alerts/notifier'
import {
  dailyTask as daily,
  dueTasks,
  handledCount,
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
 * hours agreed so far (UTC; Japan is nine hours ahead): the backup's pass at
 * 18 (it is an hourly task that starts its pass then, see below), the
 * D1 size at 19, the copy of the metrics at 20, the day's alerts counted at
 * 22, the next-day mail at 23.
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
  // The copy of the stored slide files to the backup bucket (D-66). Hourly
  // because a pass that one run cannot finish goes on at the next firing
  // (D-67): the task starts the day's pass at 18 UTC and does nothing at the
  // other hours once it is done. Without the bucket it does nothing (D-08).
  hourly('backup', (env, at) => runBackup(env, at), { logsSuccess: false }),
  // The size of D1 (D-61), then what the day brought that is told the next
  // day, then the mail of it (D-59): the three run in that order, an hour apart.
  daily('d1_size', 19, (env, at) => measureD1(env, at)),
  daily('alert_collect', 22, (env, at) => collectDaily(env, at)),
  daily('alert_digest', 23, (env, at) => sendDigest(env, at)),
])

/**
 * Runs one task and logs how it went. A failure, including one thrown before
 * the task's first await, is logged and goes no further, so no task stops
 * another. Beside the lines a task has always written, each run leaves one
 * line of the same shape (D-60): the task's name, `ok` or `failed`, how many
 * things it handled and how long it took in milliseconds. A failure is also
 * an alert for the next day, by the task's name (F39-AC3).
 */
export function runCronTask(
  task: CronTask,
  env: Env,
  at: number,
  notify: Notifier = notifierOf(env),
) {
  const started = Date.now()
  const finish = (outcome: 'ok' | 'failed', count: number) =>
    console.log(
      JSON.stringify({
        event: 'cron_task',
        task: task.name,
        outcome,
        count,
        ms: Date.now() - started,
      }),
    )
  return (async () => task.run(env, at))().then(
    (summary) => {
      if (task.logs.done !== null)
        console.log(
          JSON.stringify({
            event: task.logs.done,
            ...(typeof summary === 'object' ? summary : {}),
          }),
        )
      finish('ok', handledCount(summary))
    },
    async (error: unknown) => {
      console.error(
        JSON.stringify({
          event: task.logs.failed,
          ...task.errorFields(error),
        }),
      )
      finish('failed', 0)
      // `notify` never rejects, and a task named so that no notice can be
      // made of it still must not stop the others.
      await notifyFailure(notify, task.name).catch(() => {})
    },
  )
}

const notifyFailure = async (notify: Notifier, task: string) =>
  notify(cronFailedNotice(task, 1, runbookLink('cron_failed')))

/**
 * The Cron Trigger's handler over a list of tasks: those due at this firing
 * are all started at once, each held by `waitUntil`.
 */
export function runScheduled(
  tasks: readonly CronTask[],
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
  notify: Notifier = notifierOf(env),
) {
  // Tasks write D1 and R2, so they wait while maintenance holds the data.
  if (isMaintenance(env.MAINTENANCE)) {
    console.log(JSON.stringify({ event: 'scheduled_skipped_maintenance' }))
    return
  }
  const at = Math.floor(event.scheduledTime / 1000)
  for (const task of dueTasks(tasks, event.scheduledTime))
    ctx.waitUntil(runCronTask(task, env, at, notify))
}
