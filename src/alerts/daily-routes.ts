import { dailyNotices, d1SizeNotice } from './counted-notices'
import {
  countReportsSince,
  countStoppedFeedsSince,
  measureD1Size,
} from './count-store'
import { notifierOf } from './notify-routes'
import type { Notifier } from './notifier'
import { parseAlertThresholds } from './thresholds'

const DAY = 24 * 60 * 60

/**
 * The size of D1, once a day (F39-AC18): measured, answered so that the cron
 * log carries it, and, above the threshold, queued for the next-day mail
 * (F39-AC6).
 */
export async function measureD1(
  env: Env,
  _at: number,
  notify: Notifier = notifierOf(env),
) {
  const bytes = await measureD1Size(env.DB)
  const notice = d1SizeNotice(bytes, parseAlertThresholds(env.ALERT_THRESHOLDS))
  if (notice) await notify(notice)
  return { bytes }
}

/**
 * What happened in the last day that the operator is told the next day
 * (F39-AC4, F39-AC5): the reports made and the Luma feeds stopped, counted
 * from D1 as `at` ends the day, each as one alert with its count.
 */
export async function collectDaily(
  env: Env,
  at: number,
  notify: Notifier = notifierOf(env),
) {
  const since = at - DAY
  const [reports, stoppedFeeds] = await Promise.all([
    countReportsSince(env.DB, since),
    countStoppedFeedsSince(env.DB, since),
  ])
  const notices = dailyNotices({ reports, stoppedFeeds })
  for (const notice of notices) await notify(notice)
  return { reports, stoppedFeeds }
}
