import type { AlertRecord } from './alert-store'
import {
  ALERT_URGENCY,
  isNoticeLink,
  taskNameOf,
  type AlertKind,
} from './notice'
import {
  countText,
  holdsNoPersonalData,
  kindTitle,
  linkText,
} from './notice-text'

/** The mail of the day: what to send, to be given an address by the caller. */
export type Digest = Readonly<{ subject: string; text: string }>

const isKind = (kind: string): kind is AlertKind => kind in ALERT_URGENCY
const KINDS = Object.keys(ALERT_URGENCY) as AlertKind[]

/** The day, in Japan, of a time in seconds: "2026-11-26". */
export const dayOf = (seconds: number) =>
  new Date(seconds * 1000 + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

type Group = {
  kind: AlertKind
  task: string | null
  count: number
  link: string
}

/** The size of D1 is a level, not an amount: the largest of the days is the one to say. */
const merge = (kind: AlertKind, total: number, count: number) =>
  kind === 'd1_size' ? Math.max(total, count) : total + count

/**
 * Groups what waited: one line a kind, and for `cron_failed` one a task.
 * Rows of a kind the service no longer knows, a task that is not a name or a
 * link that is not one are left out, never repeated.
 */
function groupsOf(records: readonly AlertRecord[]): Group[] {
  const groups = new Map<string, Group>()
  for (const { kind, task, count, link } of records) {
    if (!isKind(kind) || !isNoticeLink(link)) continue
    const name =
      kind === 'cron_failed' ? (task && taskNameOf(task)) || null : null
    if (kind === 'cron_failed' && name === null) continue
    const key = `${kind}:${name ?? ''}`
    const seen = groups.get(key)
    if (seen) seen.count = merge(kind, seen.count, count)
    else groups.set(key, { kind, task: name, count, link })
  }
  return [...groups.values()].sort(
    (a, b) =>
      KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
      (a.task ?? '').localeCompare(b.task ?? ''),
  )
}

/**
 * The next-day mail (D-59): a line for each kind, with how many and where to
 * look. Null when there is nothing to say, so no mail is sent on such a day
 * (F39-AC7), and when the text would hold an address or an IP address, in
 * which case nothing leaves (F39-AC9).
 */
export function digestOf(
  records: readonly AlertRecord[],
  day: string,
  operatorOrigin: string | null,
): Digest | null {
  const groups = groupsOf(records)
  if (groups.length === 0) return null
  const lines = groups.flatMap((group) => [
    `・${kindTitle(group.kind)}${group.task ? `(${group.task})` : ''}: ${countText(group.kind, group.count)}`,
    `  手順: ${linkText(group.link, operatorOrigin)}`,
  ])
  const text = [
    `急ぎではない知らせが ${groups.length} 種類あります。`,
    '',
    ...lines,
    '',
  ].join('\n')
  return holdsNoPersonalData(text)
    ? { subject: `[slide] 運用のお知らせ(${day})`, text }
    : null
}
