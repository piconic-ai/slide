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

/**
 * What an alert says: which kind, a count, and where to look. There is
 * nowhere to put an address, a name or free text (D-58): the count says how
 * many, and the link, a path of the operator page or of a document, says
 * where. The urgency follows from the kind, so no notice can contradict it.
 */
export type Notice = {
  readonly [K in AlertKind]: Readonly<{
    kind: K
    urgency: (typeof ALERT_URGENCY)[K]
    count: number
    link: string
  }>
}[AlertKind]

/** What a link may be: no whitespace or control character, so it stays one token. */
const LINK = /^[^\s\p{Cc}]+$/u

/**
 * Makes a notice. A count that is not a whole number of at least 0, and a
 * link that is empty or holds whitespace, are mistakes of the caller and
 * throw, so that nothing malformed reaches a channel.
 */
export function noticeOf<K extends AlertKind>(
  kind: K,
  count: number,
  link: string,
): Extract<Notice, { kind: K }> {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new RangeError('A notice counts a whole number of at least 0')
  if (!LINK.test(link)) throw new RangeError('A notice links to one address')
  return { kind, urgency: ALERT_URGENCY[kind], count, link } as Extract<
    Notice,
    { kind: K }
  >
}
