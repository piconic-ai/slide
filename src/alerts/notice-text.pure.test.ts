import { expect, test } from 'vitest'
import {
  ALERT_URGENCY,
  noticeOf,
  cronFailedNotice,
  maintenanceNotice,
  MAINTENANCE_PHASES,
  type AlertKind,
} from './notice'
import {
  countText,
  holdsNoPersonalData,
  immediateText,
  kindTitle,
  linkText,
  SENDING_STALE_SECONDS,
  shownState,
} from './notice-text'

const kinds = Object.keys(ALERT_URGENCY) as AlertKind[]
const ORIGIN = 'https://admin.slide.example'

test.each(kinds)(
  'F39-AC9: Given the kind %s, When its text is made, Then it holds the title, the count and the link and no personal data',
  (kind) => {
    const notice =
      kind === 'cron_failed'
        ? cronFailedNotice('feeds_read', 4, '/operations#alerts')
        : kind === 'maintenance'
          ? maintenanceNotice('ended', 4, '/operations#alerts')
          : noticeOf(kind, 4, '/operations#alerts')
    const text = immediateText(notice, ORIGIN)
    expect(text).toContain(
      kindTitle(kind, kind === 'maintenance' ? 'ended' : null),
    )
    expect(text).toContain(countText(kind, 4))
    expect(text).toContain(`${ORIGIN}/operations#alerts`)
    expect(holdsNoPersonalData(text ?? '@')).toBe(true)
  },
)

test('Given a path of a document, When the link is shown, Then it stays a path of the repository', () => {
  expect(linkText('docs/dev/alerts.md#d1', ORIGIN)).toBe(
    'docs/dev/alerts.md#d1',
  )
})

test.each([
  ['unknown', null],
  ['not https', 'http://admin.slide.example'],
  ['with user information', 'https://a@admin.slide.example'],
  ['with a path', `${ORIGIN}/x`],
])(
  'Given an operator origin that is %s, When a path of the operator page is shown, Then it is the path alone',
  (_, origin) => {
    expect(linkText('/operations', origin)).toBe('/operations')
  },
)

test.each([
  ['an email address', 'someone@example.com'],
  ['an at sign alone', '@'],
  ['an IPv4 address', 'from 203.0.113.7 today'],
  ['a full IPv6 address', '2001:db8:0:0:0:0:0:1'],
  ['a short IPv6 address', '2001:db8::1'],
  ['the IPv6 loopback', '::1'],
])(
  'F39-AC9: Given a text with %s, When it is checked, Then it is refused',
  (_, text) => {
    expect(holdsNoPersonalData(text)).toBe(false)
  },
)

test.each([
  'ログインのメールの送信に失敗しています',
  '件数: 3 回',
  '手順: https://admin.slide.example/operations#alerts',
  '12:30',
  '[slide] D1 の大きさ 5120 MB',
])('Given the text %s, When it is checked, Then it is allowed', (text) => {
  expect(holdsNoPersonalData(text)).toBe(true)
})

test('F39-AC9: Given an operator origin with user information, When a text is made, Then it holds no at sign', () => {
  // The origin is a setting of the service; a mistaken one must not leak.
  const text = immediateText(
    noticeOf('d1_size', 1, '/operations'),
    'https://x@y.example',
  )
  expect(text).not.toBeNull()
  expect(text).not.toContain('@')
})

test.each(MAINTENANCE_PHASES)(
  'D-120: Given maintenance told as %s, When its text is made, Then the title says that phase, and the three differ',
  (phase) => {
    const text = immediateText(
      maintenanceNotice(phase, 0, '/operations#maintenance'),
      ORIGIN,
    )
    expect(text).toContain(kindTitle('maintenance', phase))
    const titles = MAINTENANCE_PHASES.map((p) => kindTitle('maintenance', p))
    expect(new Set(titles).size).toBe(3)
  },
)

test('Given a message left sending, When it is shown, Then it is failed after five minutes and not before', () => {
  expect(shownState('sending', 1000, 1000 + SENDING_STALE_SECONDS)).toBe(
    'sending',
  )
  expect(shownState('sending', 1000, 1001 + SENDING_STALE_SECONDS)).toBe(
    'failed',
  )
  for (const state of ['sent', 'failed', 'refused', 'queued'] as const)
    expect(shownState(state, 0, 10 ** 9)).toBe(state)
})
