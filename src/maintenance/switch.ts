import { INTENDED_503_HEADER } from '../alerts/response-log'

/**
 * The reasons the service is stopped for (D-116). The secret and the notice
 * both name one of these; the words for each are in `maintenance-text.ts`.
 */
export const MAINTENANCE_REASONS = ['database', 'update', 'other'] as const
export type MaintenanceReason = (typeof MAINTENANCE_REASONS)[number]

export const isReason = (value: unknown): value is MaintenanceReason =>
  (MAINTENANCE_REASONS as readonly unknown[]).includes(value)

/**
 * The header a maintenance 503 carries. The watcher (`watcher/src/observe.ts`
 * keeps its own copy of the name, since it shares no code with the service)
 * and the offline reader (work O) use it to tell the service held on purpose
 * from a fault. Its value is the switch in the form of the secret, without
 * a reason that is not known.
 */
export const MAINTENANCE_HEADER = 'X-Slide-Maintenance'

/** What the watcher and clients are asked to wait when no end is known (F38-AC14). */
export const DEFAULT_RETRY_AFTER_SECONDS = 300

/**
 * The longest wait a 503 asks for. An end written a year ahead by mistake
 * would otherwise tell crawlers to stay away for a year.
 */
export const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60

/**
 * The state of the secret `MAINTENANCE` (D-115), read from its value alone.
 * `until` is the expected end in seconds since the epoch; both details are
 * null when the value does not give them in a form that can be read.
 */
export type MaintenanceSwitch =
  | Readonly<{ kind: 'off' }>
  | Readonly<{
      kind: 'on'
      until: number | null
      reason: MaintenanceReason | null
    }>

export const SWITCH_OFF: MaintenanceSwitch = { kind: 'off' }

const UNTIL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/

/**
 * `YYYY-MM-DDTHH:MM:SSZ` in UTC as seconds since the epoch, or null for any
 * other form, and for a date that does not exist (`2026-02-30`). Only this one
 * form is read, so that a typo is not read as some other time.
 */
export function parseUntil(value: string): number | null {
  const m = UNTIL.exec(value)
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const ms = Date.UTC(y, mo - 1, d, h, mi, s)
  const back = new Date(ms)
  const real =
    back.getUTCFullYear() === y &&
    back.getUTCMonth() === mo - 1 &&
    back.getUTCDate() === d &&
    back.getUTCHours() === h &&
    back.getUTCMinutes() === mi &&
    back.getUTCSeconds() === s
  return real ? ms / 1000 : null
}

/** Seconds since the epoch as `YYYY-MM-DDTHH:MM:SSZ`. */
export const formatUntil = (seconds: number): string =>
  new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * Reads the value of `MAINTENANCE` (F38-AC15, AC16).
 *
 * - Not set, empty and `off` are off. A secret is deleted to end maintenance;
 *   `off` is read only so that it is not taken for a value that is unreadable.
 * - Anything else is on. `on` is on, as it always was; the form
 *   `on;until=2026-12-01T03:00:00Z;reason=database` is on with an expected end
 *   and a reason; a value that cannot be read is on too, with whatever pieces
 *   of it can be, because a value that was meant to stop the service and was
 *   mistyped must stop it.
 * - Each piece is `key=value` between semicolons. Unknown keys and pieces
 *   that cannot be read are ignored, and the first of a key that is given
 *   twice wins.
 */
export function parseSwitch(value: string | undefined): MaintenanceSwitch {
  const trimmed = (value ?? '').trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'off') return SWITCH_OFF
  let until: number | null = null
  let reason: MaintenanceReason | null = null
  const seen = new Set<string>()
  for (const piece of trimmed.split(';')) {
    const at = piece.indexOf('=')
    if (at < 0) continue
    const key = piece.slice(0, at).trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const text = piece.slice(at + 1).trim()
    if (key === 'until') until = parseUntil(text.toUpperCase())
    if (key === 'reason') {
      const name = text.toLowerCase()
      reason = isReason(name) ? name : null
    }
  }
  return { kind: 'on', until, reason }
}

/** Whether the value of `MAINTENANCE` holds the service. */
export const isMaintenance = (value: string | undefined) =>
  parseSwitch(value).kind === 'on'

/**
 * The expected end if it is still ahead at `now` (seconds), else null. An end
 * that has passed says nothing about when this will finish, so it is shown and
 * counted as no end at all (F38-AC14).
 */
export const expectedEnd = (
  sw: MaintenanceSwitch,
  now: number,
): number | null =>
  sw.kind === 'on' && sw.until !== null && sw.until > now ? sw.until : null

/**
 * Seconds a client is asked to wait (F38-AC13, AC14): until the expected end,
 * rounded up and at least 1, and at most a day; 300 when no end is ahead.
 */
export function retryAfterSeconds(sw: MaintenanceSwitch, now: number): number {
  const end = expectedEnd(sw, now)
  if (end === null) return DEFAULT_RETRY_AFTER_SECONDS
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(end - now)))
}

/**
 * The value of the maintenance header: `on`, with `;until=` when the secret
 * names an end, whether it is still ahead or has passed. The watcher needs
 * the end after it has passed, to tell that maintenance has run on past it
 * (D-120). Never a reason, which is for people and not for a machine to branch on.
 */
export function maintenanceHeaderValue(sw: MaintenanceSwitch): string {
  return sw.kind === 'on' && sw.until !== null
    ? `on;until=${formatUntil(sw.until)}`
    : 'on'
}

/**
 * The headers of every 503 that maintenance answers, on every origin: when to
 * come back, that the service means it (so the 5xx alert does not count it),
 * and that it is maintenance (so the watcher does not report a fault).
 */
export const maintenanceHeaders = (
  sw: MaintenanceSwitch,
  now: number,
): Readonly<Record<string, string>> => ({
  'Retry-After': String(retryAfterSeconds(sw, now)),
  [INTENDED_503_HEADER]: 'maintenance',
  [MAINTENANCE_HEADER]: maintenanceHeaderValue(sw),
})
