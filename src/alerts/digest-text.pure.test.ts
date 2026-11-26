import { expect, test } from 'vitest'
import type { AlertRecord } from './alert-store'
import { dayOf, digestOf } from './digest-text'

const ORIGIN = 'https://admin.slide.example'
let id = 0
const row = (over: Partial<AlertRecord>): AlertRecord => ({
  id: (id += 1),
  kind: 'report_received',
  count: 1,
  link: '/',
  task: null,
  raisedAt: 0,
  state: 'queued',
  ...over,
})

test('F39-AC7: Given nothing waiting, When the mail of the day is made, Then there is none', () => {
  expect(digestOf([], '2026-11-26', ORIGIN)).toBeNull()
})

test('F39-AC3: Given a task that failed three times in the day, When the mail is made, Then it names the task and the number of times', () => {
  const digest = digestOf(
    [1, 2, 3].map(() =>
      row({
        kind: 'cron_failed',
        task: 'feeds_read',
        link: '/operations#alerts',
      }),
    ),
    '2026-11-26',
    ORIGIN,
  )
  expect(digest?.subject).toBe('[slide] 運用のお知らせ(2026-11-26)')
  expect(digest?.text).toContain('定期の処理が失敗しました(feeds_read): 3 回')
  expect(digest?.text).toContain(`手順: ${ORIGIN}/operations#alerts`)
})

test('F39-AC3: Given two tasks that failed, When the mail is made, Then each has its own line', () => {
  const text = digestOf(
    [
      row({ kind: 'cron_failed', task: 'signup_sweep' }),
      row({ kind: 'cron_failed', task: 'feeds_read' }),
      row({ kind: 'cron_failed', task: 'feeds_read' }),
    ],
    '2026-11-26',
    ORIGIN,
  )?.text
  expect(text).toContain('(feeds_read): 2 回')
  expect(text).toContain('(signup_sweep): 1 回')
  expect(text?.indexOf('feeds_read')).toBeLessThan(
    text?.indexOf('signup_sweep') ?? 0,
  )
})

test('F39-AC4: Given two reports, When the mail is made, Then it holds their count and the link to the operator page', () => {
  const text = digestOf(
    [row({ count: 1, link: '/' }), row({ count: 1, link: '/' })],
    '2026-11-26',
    ORIGIN,
  )?.text
  expect(text).toContain('通報が届きました: 2 件')
  expect(text).toContain(`手順: ${ORIGIN}/`)
})

test('F39-AC5: Given a stopped feed, When the mail is made, Then it is in it', () => {
  expect(
    digestOf(
      [row({ kind: 'luma_feed_stopped', count: 2 })],
      '2026-11-26',
      ORIGIN,
    )?.text,
  ).toContain('Luma の配信が止まりました: 2 件')
})

test('F39-AC6: Given the size of D1 on two days, When the mail is made, Then it says the larger size once, not their sum', () => {
  const text = digestOf(
    [
      row({ kind: 'd1_size', count: 5200 }),
      row({ kind: 'd1_size', count: 5300 }),
    ],
    '2026-11-26',
    ORIGIN,
  )?.text
  expect(text).toContain('D1 の大きさがしきい値を超えました: 5300 MB')
  expect(text).not.toContain('10500')
})

test('F39-AC9: Given rows of an unknown kind, a task that is an address and a link that is an address, When the mail is made, Then they are left out and there is no mail', () => {
  expect(
    digestOf(
      [
        row({ kind: 'removed_kind' }),
        row({ kind: 'cron_failed', task: 'a@example.com' }),
        row({ kind: 'cron_failed', task: null }),
        row({ kind: 'report_received', link: '/someone@example.com' }),
      ],
      '2026-11-26',
      ORIGIN,
    ),
  ).toBeNull()
})

test('F39-AC9: Given an operator origin that is not https, When the mail is made, Then the links are paths and the mail holds no personal data', () => {
  const text = digestOf([row({})], '2026-11-26', 'http://10.0.0.1')?.text
  expect(text).toContain('手順: /')
  expect(text).not.toMatch(/@|\d+\.\d+\.\d+\.\d+/)
})

test.each([
  [Date.UTC(2026, 10, 26, 14, 59, 59) / 1000, '2026-11-26'],
  [Date.UTC(2026, 10, 26, 15, 0, 0) / 1000, '2026-11-27'],
  [Date.UTC(2026, 11, 31, 15, 0, 0) / 1000, '2027-01-01'],
])(
  'Given the time %s, When its day in Japan is made, Then it is %s',
  (at, day) => {
    expect(dayOf(at)).toBe(day)
  },
)
