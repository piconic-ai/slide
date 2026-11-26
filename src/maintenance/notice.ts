import { isReason, type MaintenanceReason } from './switch'

/** The one planned maintenance (F38-AC6). Times are seconds since the epoch. */
export type MaintenanceNotice = Readonly<{
  startsAt: number
  endsAt: number
  reason: MaintenanceReason
}>

/** A notice starting sooner than this gives readers a short warning (F38-AC7). */
export const NOTICE_SOON_SECONDS = 3 * 24 * 60 * 60

/**
 * The furthest ahead an end may be put. An end typed with the wrong year would
 * otherwise keep a band over every page for years.
 */
export const NOTICE_MAX_AHEAD_SECONDS = 90 * 24 * 60 * 60

/**
 * Whether the band is shown at `now` (F38-AC1, AC4): from the moment the
 * notice is put in, so that the notice goes out before the service stops,
 * until the expected end has passed.
 */
export const isShown = (notice: MaintenanceNotice, now: number) =>
  now < notice.endsAt

/** What the operator typed, as the form sent it. */
export type NoticeForm = Readonly<{
  startsAt: string
  endsAt: string
  reason: string
}>

export const EMPTY_FORM: NoticeForm = { startsAt: '', endsAt: '', reason: '' }

/** What is wrong with a form, named by the field the operator fixes. */
export type NoticeProblem =
  | 'starts_at'
  | 'ends_at'
  | 'order'
  | 'ended'
  | 'too_far'
  | 'reason'

export type NoticeInput =
  | Readonly<{
      kind: 'ok'
      notice: MaintenanceNotice
      /** The service stops in less than three days (F38-AC7): put in, with a warning. */
      soon: boolean
    }>
  | Readonly<{ kind: 'invalid'; problem: NoticeProblem }>

const JST_OFFSET_SECONDS = 9 * 60 * 60
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * What a `datetime-local` field sends, `2026-12-01T12:00`, read as Japan
 * time, in seconds since the epoch. Null for any other form and for a day or a
 * time that does not exist.
 */
export function parseJstLocal(value: string): number | null {
  const m = LOCAL.exec(value.trim())
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ]
  const s = m[6] === undefined ? 0 : Number(m[6])
  const ms = Date.UTC(y, mo - 1, d, h, mi, s)
  const back = new Date(ms)
  const real =
    back.getUTCFullYear() === y &&
    back.getUTCMonth() === mo - 1 &&
    back.getUTCDate() === d &&
    back.getUTCHours() === h &&
    back.getUTCMinutes() === mi &&
    back.getUTCSeconds() === s
  return real ? ms / 1000 - JST_OFFSET_SECONDS : null
}

/**
 * Reads the form at `now` (F38-AC1, AC6, AC7). The times are Japan time. The
 * start may already have passed, since the service may already be stopped, but
 * the end must be ahead and after the start, and not absurdly far.
 */
export function parseNoticeForm(form: NoticeForm, now: number): NoticeInput {
  const startsAt = parseJstLocal(form.startsAt)
  if (startsAt === null) return { kind: 'invalid', problem: 'starts_at' }
  const endsAt = parseJstLocal(form.endsAt)
  if (endsAt === null) return { kind: 'invalid', problem: 'ends_at' }
  if (!isReason(form.reason)) return { kind: 'invalid', problem: 'reason' }
  if (endsAt <= startsAt) return { kind: 'invalid', problem: 'order' }
  if (endsAt <= now) return { kind: 'invalid', problem: 'ended' }
  if (endsAt > now + NOTICE_MAX_AHEAD_SECONDS)
    return { kind: 'invalid', problem: 'too_far' }
  return {
    kind: 'ok',
    notice: { startsAt, endsAt, reason: form.reason },
    soon: startsAt - now < NOTICE_SOON_SECONDS,
  }
}
