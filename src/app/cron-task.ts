/**
 * When a cron task runs, relative to the one Cron Trigger the service has.
 * That trigger fires every hour (`17 * * * *` in wrangler.jsonc), so a task
 * runs either at every firing, or at the one firing of the day that falls in
 * its hour (UTC).
 */
export type CronSchedule =
  | Readonly<{ kind: 'hourly' }>
  | Readonly<{ kind: 'daily'; hourUtc: number }>

/** The log events of one task: a line for success, if any, and one for failure. */
export type CronLogs = Readonly<{ done: string | null; failed: string }>

/**
 * One thing the Cron Trigger does. `run` gets the environment and the time of
 * the firing in seconds. `errorFields` says which parts of a failure may be
 * logged beside the event; never the whole error.
 */
export type CronTask = Readonly<{
  name: string
  schedule: CronSchedule
  logs: CronLogs
  run: (env: Env, at: number) => Promise<unknown>
  errorFields: (error: unknown) => Readonly<Record<string, unknown>>
}>

export type CronTaskOptions = Readonly<{
  /** False for a task that logs nothing when it works. */
  logsSuccess?: boolean
  /** The fields of a failure to log. Only the error's name, by default. */
  errorFields?: CronTask['errorFields']
}>

const NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/

/** The name of an error, and nothing else of it. */
const nameOnly: CronTask['errorFields'] = (error) => ({
  name: error instanceof Error ? error.name : 'unknown',
})

function taskOf(
  name: string,
  schedule: CronSchedule,
  run: CronTask['run'],
  options: CronTaskOptions,
): CronTask {
  if (!NAME.test(name))
    throw new RangeError(`A cron task is named in snake_case: ${name}`)
  return {
    name,
    schedule,
    // The event names are the task's name and `<name>_error`: the lines the
    // service has always written for its tasks.
    logs: {
      done: options.logsSuccess === false ? null : name,
      failed: `${name}_error`,
    },
    run,
    errorFields: options.errorFields ?? nameOnly,
  }
}

/** A task that runs at every firing of the Cron Trigger. */
export const hourlyTask = (
  name: string,
  run: CronTask['run'],
  options: CronTaskOptions = {},
) => taskOf(name, { kind: 'hourly' }, run, options)

/**
 * A task that runs once a day, at the firing that falls in `hourUtc` (0 to
 * 23). A firing is hourly, so exactly one falls in each hour.
 */
export function dailyTask(
  name: string,
  hourUtc: number,
  run: CronTask['run'],
  options: CronTaskOptions = {},
) {
  if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23)
    throw new RangeError(`A daily cron task runs at an hour of 0 to 23 UTC`)
  return taskOf(name, { kind: 'daily', hourUtc }, run, options)
}

/** Whether a schedule runs at the firing at `scheduledTime` (milliseconds). */
export function isDue(schedule: CronSchedule, scheduledTime: number) {
  switch (schedule.kind) {
    case 'hourly':
      return true
    case 'daily':
      return new Date(scheduledTime).getUTCHours() === schedule.hourUtc
  }
}

/** The tasks that run at a firing, in the order they are listed. */
export const dueTasks = (tasks: readonly CronTask[], scheduledTime: number) =>
  tasks.filter((task) => isDue(task.schedule, scheduledTime))

/** The list itself, once its names are known to be different. */
export function registerTasks(tasks: readonly CronTask[]) {
  const seen = new Set<string>()
  for (const { name } of tasks) {
    if (seen.has(name)) throw new RangeError(`Two cron tasks named ${name}`)
    seen.add(name)
  }
  return tasks
}
