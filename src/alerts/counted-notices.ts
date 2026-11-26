import { noticeOf, runbookLink, type Notice } from './notice'
import type { AlertThresholds } from './thresholds'

/** A report is looked at on the operator page, which lists the reported decks. */
export const REPORTS_LINK = '/'

const MEGABYTE = 10 ** 6

/**
 * The alert for failures to send login mail, when `failures` have been
 * counted within the window and reach the threshold (F39-AC1). Told at once.
 */
export function loginMailNotice(
  failures: number,
  thresholds: AlertThresholds,
): Notice | null {
  return failures >= thresholds.loginMailFailures
    ? noticeOf('login_mail_failed', failures, runbookLink('login_mail_failed'))
    : null
}

/**
 * The alert for the size of D1, when it is above the threshold (F39-AC6). The
 * count is the size in whole megabytes, rounded up, so that a size just over
 * is never told as the threshold itself.
 */
export function d1SizeNotice(
  bytes: number,
  thresholds: AlertThresholds,
): Notice | null {
  return bytes > thresholds.d1SizeBytes
    ? noticeOf('d1_size', Math.ceil(bytes / MEGABYTE), runbookLink('d1_size'))
    : null
}

/** What the day's counts say: a report or a stopped feed is one alert each (F39-AC4, F39-AC5). */
export function dailyNotices(
  counts: Readonly<{ reports: number; stoppedFeeds: number }>,
): Notice[] {
  return [
    ...(counts.reports > 0
      ? [noticeOf('report_received', counts.reports, REPORTS_LINK)]
      : []),
    ...(counts.stoppedFeeds > 0
      ? [
          noticeOf(
            'luma_feed_stopped',
            counts.stoppedFeeds,
            runbookLink('luma_feed_stopped'),
          ),
        ]
      : []),
  ]
}
