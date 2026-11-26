import { expect, test } from 'vitest'
import { d1SizeNotice, dailyNotices, loginMailNotice } from './counted-notices'
import { parseAlertThresholds } from './thresholds'

const defaults = parseAlertThresholds({})

test.each([
  [0, false],
  [2, false],
  [3, true],
  [4, true],
])(
  'F39-AC1: Given %s failures to send login mail in the window, When they are counted, Then an alert is %s',
  (failures, told) => {
    const notice = loginMailNotice(failures, defaults)
    expect(notice !== null).toBe(told)
    if (notice)
      expect(notice).toMatchObject({
        kind: 'login_mail_failed',
        urgency: 'immediate',
        count: failures,
      })
  },
)

test('F39-AC16: Given a threshold of 10 failures, When 9 and 10 are counted, Then only 10 is told', () => {
  const thresholds = parseAlertThresholds({ loginMailFailures: 10 })
  expect(loginMailNotice(9, thresholds)).toBeNull()
  expect(loginMailNotice(10, thresholds)).not.toBeNull()
})

test.each([
  [0, false],
  [4_999_999_999, false],
  [5_000_000_000, false],
  [5_000_000_001, true],
  [9_999_999_999, true],
])(
  'F39-AC6: Given D1 of %s bytes, When its size is judged, Then it is told: %s',
  (bytes, told) => {
    expect(d1SizeNotice(bytes, defaults) !== null).toBe(told)
  },
)

test('F39-AC6: Given D1 just over the threshold, When it is judged, Then the size is in megabytes rounded up and the alert waits for the next day', () => {
  expect(d1SizeNotice(5_000_000_001, defaults)).toMatchObject({
    kind: 'd1_size',
    urgency: 'next_day',
    count: 5001,
  })
})

test('F39-AC16: Given a threshold of 1 MB, When D1 is 1,500,000 bytes, Then it is told as 2 MB', () => {
  const thresholds = parseAlertThresholds({ d1SizeBytes: 1_000_000 })
  expect(d1SizeNotice(1_500_000, thresholds)?.count).toBe(2)
})

test('F39-AC7: Given a day with no reports and no stopped feed, When the counts are judged, Then there is nothing to tell', () => {
  expect(dailyNotices({ reports: 0, stoppedFeeds: 0 })).toEqual([])
})

test('F39-AC4: Given 2 reports, When the counts are judged, Then one alert holds the count and the link to the operator page', () => {
  expect(dailyNotices({ reports: 2, stoppedFeeds: 0 })).toEqual([
    {
      kind: 'report_received',
      urgency: 'next_day',
      count: 2,
      link: '/',
    },
  ])
})

test('F39-AC5: Given a stopped feed, When the counts are judged, Then one alert is made for it', () => {
  expect(
    dailyNotices({ reports: 0, stoppedFeeds: 1 }).map((n) => [n.kind, n.count]),
  ).toEqual([['luma_feed_stopped', 1]])
})
