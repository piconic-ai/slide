import { expect, test } from 'vitest'
import {
  ALERT_URGENCY,
  cronFailedNotice,
  isNoticeLink,
  maintenanceNotice,
  MAINTENANCE_PHASES,
  noticeOf,
  OPERATOR_LINKS,
  runbookLink,
  taskNameOf,
  type AlertKind,
} from './notice'
import { noopNotifier } from './notifier'

const kinds = Object.keys(ALERT_URGENCY) as AlertKind[]
const counted = kinds.filter(
  (kind) => kind !== 'cron_failed' && kind !== 'maintenance',
)

test.each(counted)(
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
    expect(() => noticeOf('d1_size', count, '/operations')).toThrow(RangeError)
  },
)

test('Given a count of 0, When a notice is made, Then it is allowed', () => {
  expect(noticeOf('d1_size', 0, '/operations').count).toBe(0)
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

test('Given the no-op sender, When it is told an alert, Then it resolves with nothing', async () => {
  await expect(
    noopNotifier(maintenanceNotice('started', 1, '/operations')),
  ).resolves.toBeUndefined()
})

test('F39-AC9: Given a cron task, When its failure notice is made, Then it names the task and carries the next-day urgency', () => {
  expect(cronFailedNotice('feeds_read', 2, '/operations#alerts')).toEqual({
    kind: 'cron_failed',
    urgency: 'next_day',
    count: 2,
    link: '/operations#alerts',
    task: 'feeds_read',
  })
})

test.each([
  ['an address', 'a@example.com'],
  ['a name with a space', 'Taro Yamada'],
  ['a name in capitals', 'Taro'],
  ['a dotted name', 'feeds.read'],
  ['an empty name', ''],
  ['a name with a dash', 'feeds-read'],
  ['a name over 40 characters', `a${'b'.repeat(40)}`],
  ['a name ending in an underscore', 'feeds_'],
])(
  'F39-AC9: Given %s as a task, When a failure notice is made, Then it is refused',
  (_, task) => {
    expect(taskNameOf(task)).toBeNull()
    expect(() => cronFailedNotice(task, 1, '/operations')).toThrow(RangeError)
  },
)

test.each([
  ['an email address as a path', '/someone@example.com'],
  ['a handle and a slug of a person', '/@someone/their-slide'],
  ['a query', '/operations?who=1'],
  ['an address with user information', 'https://a@admin.example.com/x'],
  ['an address with a port', 'https://admin.example.com:8787/x'],
  ['an address on any host', 'https://admin.slide.example/operations#alerts'],
  ['a plain-http address', 'http://admin.example.com/x'],
  ['an IPv4 host', 'https://10.0.0.1/x'],
  ['a hexadecimal host', 'https://0x7f.0.0.1/'],
  ['a protocol-relative address', '//evil.example.com/x'],
  ['a backslash form', '/\\evil.example.com'],
  ['an IPv4 address in a path', '/operations/10.0.0.1'],
  ['an IPv6 address', '/::1'],
  ['no leading slash', 'operations'],
  ['an unknown page of the operator host', '/operations#anything'],
  ['an unknown page of the steps', 'docs/dev/alerts-runbook.md#no-such-kind'],
  ['another document', 'docs/dev/deploy.md'],
  ['a trailing slash', '/operations/'],
  ['a different case', '/Operations'],
  ['a percent escape', '/a%40b'],
  ['empty', ''],
  ['whitespace around a good link', ' /operations'],
  ['a newline after a good link', '/operations\n'],
])(
  'F39-AC9: Given a link that is %s, When it is checked, Then it is refused',
  (_, link) => {
    expect(isNoticeLink(link)).toBe(false)
    expect(() => noticeOf('d1_size', 1, link)).toThrow(RangeError)
    expect(() => cronFailedNotice('feeds_read', 1, link)).toThrow(RangeError)
    expect(() => maintenanceNotice('ended', 0, link)).toThrow(RangeError)
  },
)

test.each([...OPERATOR_LINKS, ...kinds.map(runbookLink)])(
  'Given the link %s, When it is checked, Then it is allowed',
  (link) => {
    expect(isNoticeLink(link)).toBe(true)
  },
)

test.each(MAINTENANCE_PHASES)(
  'D-120: Given the phase %s, When a maintenance notice is made, Then it is told at once and carries its phase',
  (phase) => {
    expect(maintenanceNotice(phase, 0, '/operations#maintenance')).toEqual({
      kind: 'maintenance',
      urgency: 'immediate',
      count: 0,
      link: '/operations#maintenance',
      phase,
    })
  },
)

test('D-120: Given a phase that is not one of the three, When a maintenance notice is made, Then it is refused', () => {
  expect(() => maintenanceNotice('paused' as never, 0, '/operations')).toThrow(
    RangeError,
  )
})

test.each([
  ['cron_failed', 'docs/dev/alerts-runbook.md#cron-failed'],
  ['luma_feed_stopped', 'docs/dev/alerts-runbook.md#luma-feed-stopped'],
  ['d1_size', 'docs/dev/alerts-runbook.md#d1-size'],
] as const)(
  'Given the kind %s, When its steps are linked, Then the link is %s and is a link a notice may carry',
  (kind, link) => {
    expect(runbookLink(kind)).toBe(link)
    expect(isNoticeLink(link)).toBe(true)
  },
)

test.each(kinds)(
  'Given the kind %s, When its steps are linked, Then a notice may carry the link',
  (kind) => {
    expect(isNoticeLink(runbookLink(kind))).toBe(true)
  },
)
