import type { Hono } from 'hono'
import { csvOf } from '../metrics/csv'
import { readMetricsFrame } from '../metrics/frame-routes'
import { dayOf } from '../metrics/day'
import type { OperatorEnv } from './operator-env'
import { METRICS_CSV_PATH, metricsPage } from './metrics-page'

const now = () => Math.floor(Date.now() / 1000)

/**
 * `GET /metrics` and `GET /metrics.csv`, on the operator host only, behind
 * the same Access check as every operator page (F40-AC21). The CSV holds the
 * table the page draws, so the two are made from one read.
 */
export function mountMetrics(app: Hono<OperatorEnv>, policy: string) {
  app.get('/metrics', async (c) =>
    c.html(
      metricsPage({
        operator: c.get('operator'),
        weekly: await readMetricsFrame(c.env, now()),
      }),
      200,
      { 'Content-Security-Policy': policy },
    ),
  )
  app.get(METRICS_CSV_PATH, async (c) => {
    const at = now()
    const { table } = await readMetricsFrame(c.env, at)
    // A byte order mark first, so that a spreadsheet reads the Japanese as UTF-8.
    return c.body(`﻿${csvOf(table)}`, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="metrics-${dayOf(at)}.csv"`,
      'X-Content-Type-Options': 'nosniff',
    })
  })
}
