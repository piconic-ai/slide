import type { Observation } from './watch-step'

/**
 * The header that tells maintenance from a fault (D-57, D-120). The service
 * answers 503 for both, so the answer alone cannot say which. The name is a
 * stand-in until work N, which makes the service send it, fixes the real one:
 * change this constant, and only this, to match.
 */
export const MAINTENANCE_HEADER = 'x-slide-maintenance'

/** Whether an answer says the service is held for maintenance on purpose. */
export const isMaintenanceAnswer = (status: number, headers: Headers) =>
  status === 503 && headers.has(MAINTENANCE_HEADER)

/**
 * Checks one address once. It is open when something answers below 500, a
 * redirect and a 404 included: the check is that the Worker and what it reads
 * are up, not that a page exists. A network error, a time out and a 5xx are a
 * failure; maintenance is its own result. The body is never read.
 */
export async function observeAddress(
  url: string,
  send: typeof fetch,
  timeoutMs: number,
): Promise<Observation> {
  try {
    const response = await send(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'slide-watcher' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    await response.body?.cancel()
    if (isMaintenanceAnswer(response.status, response.headers))
      return 'maintenance'
    return response.status >= 500 ? 'failed' : 'ok'
  } catch {
    return 'failed'
  }
}
