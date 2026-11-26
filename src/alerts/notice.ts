/**
 * How soon each kind of alert is told (D-55, D-56): at once to Discord, or the
 * next day in one mail. The kinds are the rows of D-56 that this service's
 * code sends. The rows Cloudflare sends (5xx, the rate limits, billing) are
 * set up in its dashboard and are not here. A kind is added only when D-56
 * gains a row.
 */
export const ALERT_URGENCY = {
  /** The top page, a viewer or the content origin did not open. */
  page_unreachable: 'immediate',
  /** Sending login mail failed. */
  login_mail_failed: 'immediate',
  /** Sign-ups rose far above the usual (D-128). */
  signup_surge: 'immediate',
  /** Login mail nears or reaches the hourly total (D-127). */
  mail_flood: 'immediate',
  /** Maintenance started, ended, or ran past its expected end (D-120). */
  maintenance: 'immediate',
  /** The check after a deploy failed (D-106). */
  deploy_check_failed: 'immediate',
  /** A cron task failed. */
  cron_failed: 'next_day',
  /** A Luma feed stopped. */
  luma_feed_stopped: 'next_day',
  /** D1 passed half of its limit. */
  d1_size: 'next_day',
  /** A deck was reported. */
  report_received: 'next_day',
  /** The backup failed. */
  backup_failed: 'next_day',
} as const

export type AlertKind = keyof typeof ALERT_URGENCY
export type AlertUrgency = (typeof ALERT_URGENCY)[AlertKind]

/** The kinds whose notice is only a count and a link. */
type CountedKind = Exclude<AlertKind, 'cron_failed'>

type Base<K extends AlertKind> = Readonly<{
  kind: K
  urgency: (typeof ALERT_URGENCY)[K]
  count: number
  link: string
}>

/**
 * A cron task that failed. The task is named by the snake_case name it is
 * registered under (`src/app/cron-routes.ts`), which the next-day mail
 * needs to say which task failed. That shape holds no `@`, no dot and no
 * space, so it cannot carry an address, an IP address or a person's name.
 */
export type CronFailedNotice = Base<'cron_failed'> &
  Readonly<{ task: TaskName }>

/**
 * What an alert says: which kind, a count, and where to look. There is
 * nowhere to put an address, a name or free text (D-58): the count says how
 * many, and the link, a path of the operator page or of a document, says
 * where. The urgency follows from the kind, so no notice can contradict it.
 */
export type Notice =
  | { readonly [K in CountedKind]: Base<K> }[CountedKind]
  | CronFailedNotice

declare const taskNameBrand: unique symbol
/** A cron task's name, checked by `taskNameOf`. */
export type TaskName = string & { readonly [taskNameBrand]: true }

const TASK_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/
const TASK_NAME_MAX = 40

/** The name as a `TaskName`, or null when it is not a snake_case name. */
export const taskNameOf = (name: string): TaskName | null =>
  name.length <= TASK_NAME_MAX && TASK_NAME.test(name)
    ? (name as TaskName)
    : null

/**
 * What a link may be: a path on the operator page (`/operations#alerts`), a
 * path of a document in the repository (`docs/dev/alerts.md#anchor`), or an
 * address on a host of https. Only letters, digits and `._~/#-` follow, so
 * there is no `@`, no `:`, no query and no space: an email address cannot be
 * written in one. An IPv4 address is refused apart, for the host and the path.
 */
const LINK =
  /^(?:https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\/|\/|docs\/)[A-Za-z0-9._~/#-]*$/
const DOTTED_QUAD = /\d+\.\d+\.\d+\.\d+/
export const LINK_MAX = 200

/** Whether a string may be the link of a notice. */
export const isNoticeLink = (link: string) =>
  link.length <= LINK_MAX && LINK.test(link) && !DOTTED_QUAD.test(link)

function check(count: number, link: string) {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new RangeError('A notice counts a whole number of at least 0')
  if (!isNoticeLink(link))
    throw new RangeError(
      'A notice links to a path of the service or of a document',
    )
}

/**
 * Makes a notice. A count that is not a whole number of at least 0, and a
 * link that is not a path or an https address, are mistakes of the caller and
 * throw, so that nothing malformed reaches a channel.
 */
export function noticeOf<K extends CountedKind>(
  kind: K,
  count: number,
  link: string,
): Extract<Notice, { kind: K }> {
  check(count, link)
  return { kind, urgency: ALERT_URGENCY[kind], count, link } as Extract<
    Notice,
    { kind: K }
  >
}

/** A failed cron task: `count` failures of the task named `task`. */
export function cronFailedNotice(
  task: string,
  count: number,
  link: string,
): CronFailedNotice {
  check(count, link)
  const name = taskNameOf(task)
  if (!name) throw new RangeError('A cron task is named in snake_case')
  return { kind: 'cron_failed', urgency: 'next_day', count, link, task: name }
}
