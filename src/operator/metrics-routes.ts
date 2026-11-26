import type { Hono } from 'hono'
import type { OperatorEnv } from './operator-env'
import { metricsPage } from './metrics-page'

/** `GET /metrics`, on the operator host only. Work A reads the week table. */
export function mountMetrics(app: Hono<OperatorEnv>, policy: string) {
  app.get('/metrics', (c) =>
    c.html(
      metricsPage({ operator: c.get('operator'), weekly: { kind: 'pending' } }),
      200,
      { 'Content-Security-Policy': policy },
    ),
  )
}
