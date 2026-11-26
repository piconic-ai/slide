import type { Observation } from './watch-step'

/**
 * The header that tells maintenance from a fault (D-57, D-120). The service
 * answers 503 for both, so the answer alone cannot say which. The service sends
 * it on every maintenance 503 (`src/maintenance/switch.ts`, which keeps its own
 * copy of the name: the watcher shares no code with the service, and
 * `src/maintenance/maintenance-watcher.test.ts` checks that the two agree).
 * Header names are not case-sensitive.
 */
export const MAINTENANCE_HEADER = 'x-slide-maintenance'

/** Whether an answer says the service is held for maintenance on purpose. */
export const isMaintenanceAnswer = (status: number, headers: Headers) =>
  status === 503 && headers.has(MAINTENANCE_HEADER)

/** What one check saw, and the end that maintenance named, if it did. */
export type Sighting = Readonly<{
  seen: Observation
  /** The expected end of maintenance in seconds since the epoch, when the answer names one. */
  until: number | null
}>

const UNTIL =
  /(?:^|;)\s*until=(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z\s*(?:;|$)/i

/**
 * The end that the maintenance header names (`on;until=2026-12-01T03:00:00Z`),
 * in seconds, or null when it names none or names a time that does not exist.
 */
export function untilOf(headers: Headers): number | null {
  const m = UNTIL.exec(headers.get(MAINTENANCE_HEADER) ?? '')
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  const real =
    at.getUTCFullYear() === y &&
    at.getUTCMonth() === mo - 1 &&
    at.getUTCDate() === d &&
    at.getUTCHours() === h &&
    at.getUTCMinutes() === mi &&
    at.getUTCSeconds() === s
  return real ? at.getTime() / 1000 : null
}

/**
 * Checks one address once. It is open when something answers below 500, a
 * redirect and a 404 included: the check is that the Worker and what it reads
 * are up, not that a page exists. A network error, a time out and a 5xx are a
 * failure; maintenance is its own result, with its end when it names one. The
 * body is never read.
 */
export async function observeAddress(
  url: string,
  send: typeof fetch,
  timeoutMs: number,
): Promise<Sighting> {
  try {
    const response = await send(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'slide-watcher' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    await response.body?.cancel()
    if (isMaintenanceAnswer(response.status, response.headers))
      return { seen: 'maintenance', until: untilOf(response.headers) }
    return { seen: response.status >= 500 ? 'failed' : 'ok', until: null }
  } catch {
    return { seen: 'failed', until: null }
  }
}
