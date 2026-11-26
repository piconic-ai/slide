import { expect, test } from 'vitest'
import {
  alertsFrame,
  WEBHOOK_STEPS,
  type RecentAlert,
} from './operations-alerts-frame'

const AT = Date.UTC(2026, 10, 26, 3, 5, 9) / 1000
const recent = (over: Partial<RecentAlert> = {}): RecentAlert => ({
  kind: 'login_mail_failed',
  count: 3,
  raisedAt: AT,
  state: 'sent',
  ...over,
})
const drawn = (view: Parameters<typeof alertsFrame>[0]) =>
  String(alertsFrame(view))

test('F39-AC11: Given no usable webhook, When the frame is drawn, Then it says 未設定, what to set and where the steps are, under its heading', () => {
  const page = drawn({ kind: 'not_configured', recent: [] })
  expect(page).toMatch(/<h2>通知<\/h2>\s*<p class="not-configured"/)
  expect(page).toContain('未設定')
  expect(page).toContain('<code>DISCORD_WEBHOOK_URL</code>')
  expect(page).toContain(`<code>${WEBHOOK_STEPS}</code>`)
  expect(page).not.toContain('設定されています。')
})

test('F39-AC11: Given a usable webhook, When the frame is drawn, Then it says the destination is set and shows no 未設定', () => {
  const page = drawn({ kind: 'ready', recent: [] })
  expect(page).toContain('送り先(Discord)は、設定されています')
  expect(page).not.toContain('未設定')
})

test('F39-AC20: Given no alert yet, When the frame is drawn, Then it says so and draws no table', () => {
  const page = drawn({ kind: 'ready', recent: [] })
  expect(page).toContain('通知はまだありません。')
  expect(page).not.toContain('<table')
})

test('F39-AC20: Given alerts, When the frame is drawn, Then each row has its time, its kind, its count and what became of it, in the order given', () => {
  const page = drawn({
    kind: 'ready',
    recent: [
      recent(),
      recent({
        kind: 'd1_size',
        count: 5200,
        state: 'queued',
        raisedAt: AT - 3600,
      }),
      recent({ kind: 'cron_failed', count: 2, state: 'mailed' }),
    ],
  })
  expect(page).toContain('<th scope="col">日時</th>')
  expect(page).toContain('2026-11-26T03:05:09.000Z')
  expect(page).toContain('ログインのメールの送信に失敗しています')
  expect(page).toContain('3 回')
  expect(page).toContain('Discord に送信済み')
  expect(page).toContain('5200 MB')
  expect(page).toContain('翌日のメールを待っている')
  expect(page).toContain('メールで送信済み')
  expect(page.indexOf('ログインのメール')).toBeLessThan(
    page.indexOf('D1 の大きさ'),
  )
  expect(page).toContain('<div class="table-scroll">')
})

test.each([
  ['sending', '送信中'],
  ['failed', '送信に失敗'],
  ['not_configured', '送り先が未設定のため送らず'],
] as const)(
  'F39-AC20: Given an alert in the state %s, When the frame is drawn, Then it reads %s',
  (state, text) => {
    expect(drawn({ kind: 'ready', recent: [recent({ state })] })).toContain(
      text,
    )
  },
)

test('F39-AC20: Given a kind the service no longer knows, When the frame is drawn, Then the row says so and the stored text is not drawn as markup', () => {
  const page = drawn({
    kind: 'ready',
    recent: [recent({ kind: '<script>x</script>', count: 4 })],
  })
  expect(page).toContain('(いまは使わない種類)')
  expect(page).not.toContain('<script>')
})
