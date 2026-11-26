import type { Context, MiddlewareHandler } from 'hono'
import { privateHeaders } from '../preview/pages'
import { ERROR_PAGE_POLICY } from '../site/error-pages'
import { langOf } from '../site/lang'
import { hasPass } from './pass-routes'
import { maintenancePage } from './maintenance-page'
import {
  expectedEnd,
  formatUntil,
  maintenanceHeaders,
  parseSwitch,
  type MaintenanceSwitch,
} from './switch'

const nowSeconds = () => Math.floor(Date.now() / 1000)

/**
 * The answer to a request while maintenance holds the service (F38-AC9,
 * AC13): a 503 that asks to come back at the expected end, in a page, or in
 * JSON for the API. It reads no data, so it stands while D1 is restored.
 */
export function maintenanceResponse(
  c: Context<{ Bindings: Env }>,
  sw: Extract<MaintenanceSwitch, { kind: 'on' }>,
  now: number,
) {
  const headers = {
    'Cache-Control': 'no-store',
    ...maintenanceHeaders(sw, now),
  }
  const until = expectedEnd(sw, now)
  if (c.req.path.startsWith('/api/'))
    return c.json(
      {
        error: 'Under maintenance; retry later',
        code: 'maintenance',
        ...(until === null ? {} : { until: formatUntil(until) }),
        ...(sw.reason === null ? {} : { reason: sw.reason }),
      },
      503,
      headers,
    )
  return c.html(
    maintenancePage(
      { until, reason: sw.reason },
      langOf(c),
      new URL(c.req.url),
    ),
    503,
    { ...headers, 'Content-Security-Policy': ERROR_PAGE_POLICY },
  )
}

/**
 * The answer of the origins that have no page of their own, the content
 * origin and the operator host, to anything while maintenance holds the
 * service: the same 503, in plain text, with the same headers.
 */
export const plainHeldResponse = (
  sw: Extract<MaintenanceSwitch, { kind: 'on' }>,
  now: number,
) =>
  new Response('Under maintenance', {
    status: 503,
    headers: { ...privateHeaders, ...maintenanceHeaders(sw, now) },
  })

/**
 * Set the MAINTENANCE secret to hold the service: every request that reaches
 * this answers 503 (`parseSwitch` says which values hold it). Pages that are
 * mounted before it, those that stay readable, are not held.
 */
export const maintenance: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  const sw = parseSwitch(c.env.MAINTENANCE)
  if (sw.kind === 'off') return next()
  const now = nowSeconds()
  // An operator who came in by the entrance is let through (D-118).
  if (await hasPass(c, now)) return next()
  return maintenanceResponse(c, sw, now)
}
