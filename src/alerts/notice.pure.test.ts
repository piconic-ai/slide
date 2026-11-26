import { expect, test } from 'vitest'
import { ALERT_URGENCY, noticeOf, type AlertKind } from './notice'
import { noopNotifier } from './notifier'

const kinds = Object.keys(ALERT_URGENCY) as AlertKind[]

test.each(kinds)(
  'Given the kind %s, When a notice is made, Then it carries the urgency of its kind, the count and the link and nothing else',
  (kind) => {
    const notice = noticeOf(kind, 3, '/operations#alerts')
    expect(notice).toEqual({
      kind,
      urgency: ALERT_URGENCY[kind],
      count: 3,
      link: '/operations#alerts',
    })
  },
)

test('Given D-56, When the kinds are listed, Then the rows sent at once and the next day are as decided', () => {
  const at = (urgency: string) =>
    kinds.filter((kind) => ALERT_URGENCY[kind] === urgency).sort()
  expect(at('immediate')).toEqual(
    [
      'page_unreachable',
      'login_mail_failed',
      'signup_surge',
      'mail_flood',
      'maintenance',
      'deploy_check_failed',
    ].sort(),
  )
  expect(at('next_day')).toEqual(
    [
      'cron_failed',
      'luma_feed_stopped',
      'd1_size',
      'report_received',
      'backup_failed',
    ].sort(),
  )
})

test.each([
  ['negative', -1],
  ['fractional', 1.5],
  ['NaN', Number.NaN],
  ['infinite', Number.POSITIVE_INFINITY],
  ['beyond a safe integer', 2 ** 53],
])(
  'Given a %s count, When a notice is made, Then it is refused',
  (_, count) => {
    expect(() => noticeOf('cron_failed', count, '/operations')).toThrow(
      RangeError,
    )
  },
)

test('Given a count of 0, When a notice is made, Then it is allowed', () => {
  expect(noticeOf('maintenance', 0, '/operations').count).toBe(0)
})

test.each([
  ['empty', ''],
  ['with a space', '/a b'],
  ['with a newline', '/a\nb'],
  ['with a tab', '/a\tb'],
  ['with a NUL', '/a\u0000b'],
  ['with a line separator', '/a b'],
])('Given a link %s, When a notice is made, Then it is refused', (_, link) => {
  expect(() => noticeOf('d1_size', 1, link)).toThrow(RangeError)
})

test('Given a link that is a full address, When a notice is made, Then it is kept as it is', () => {
  const link = 'https://admin.slide.example/operations#alerts'
  expect(noticeOf('backup_failed', 1, link).link).toBe(link)
})

test('Given the no-op sender, When it is told an alert, Then it resolves with nothing', async () => {
  await expect(
    noopNotifier(noticeOf('cron_failed', 1, '/operations')),
  ).resolves.toBeUndefined()
})
