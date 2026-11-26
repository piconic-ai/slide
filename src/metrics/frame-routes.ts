import type { MetricsFrameView } from '../operator/metrics-page'
import { copySettingsOf } from './daily-routes'
import { readLastCopy } from './daily-store'
import { metricsTable } from './table'
import { readAuthorsByWeek, readDailyTotals } from './table-store'
import { lastWeeks } from './weeks'

/**
 * What the operator's metrics page shows (F40-AC18): the last 12 weeks, from
 * the copied days and the authors counted in D1, and which settings are
 * missing, if any. The table is drawn whatever is missing: the copied days
 * and the exact counts stay worth showing without Analytics Engine.
 */
export async function readMetricsFrame(
  env: Env,
  at: number,
): Promise<MetricsFrameView> {
  const weeks = lastWeeks(at)
  const [first, last] = [weeks[0], weeks[weeks.length - 1]]
  const [totals, authors, lastCopy] = await Promise.all([
    readDailyTotals(env.DB, first?.start ?? '', last?.end ?? ''),
    readAuthorsByWeek(env.DB, weeks),
    readLastCopy(env.DB),
  ])
  const settings = copySettingsOf(env)
  return {
    kind: 'table',
    table: metricsTable(weeks, totals, authors),
    missing: settings.kind === 'ready' ? [] : settings.missing,
    lastCopy: lastCopy && { day: lastCopy.day, truncated: lastCopy.truncated },
  }
}
