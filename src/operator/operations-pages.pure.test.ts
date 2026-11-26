import { expect, test } from 'vitest'
import { metricsPage, type MetricsFrameView } from './metrics-page'
import { readyView } from './operations-maintenance-frame'
import { operationsPage, type OperationsView } from './operations-pages'

const EMPTY_WEEKLY: MetricsFrameView = {
  kind: 'table',
  table: { weeks: [], groups: [] },
  missing: [],
  lastCopy: null,
}

const view = (email = 'op@example.com'): OperationsView => ({
  operator: { email },
  maintenance: readyView(null, false),
  signups: { kind: 'pending' },
  email: { kind: 'not_configured' },
  backups: { kind: 'not_configured' },
  alerts: { kind: 'not_configured', recent: [] },
})

test('Given the operations page, When drawn, Then the five frames follow in the order of the page list and each of those not built says so', async () => {
  const page = String(await operationsPage(view()))
  const headings = [
    'メンテナンスの予定',
    '新しい登録',
    'メールアドレスの暗号化',
    'バックアップ',
    '通知',
  ]
  const at = headings.map((heading) => page.indexOf(`<h2>${heading}</h2>`))
  expect(at.every((index) => index > 0)).toBe(true)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
  expect(page.match(/<h2>/g)).toHaveLength(5)
  // The frames of the notice, the email addresses, the backups and the alerts are built; only the sign-ups are not yet.
  expect(page.match(/準備中です。/g)).toHaveLength(1)
  expect(page.match(/<h1>/g)).toHaveLength(1)
  expect(page).toContain('<title>運用 - ')
})

test('Given an operator address with markup, When either page is drawn, Then it is escaped', async () => {
  const evil = '<b>x</b>@example.com'
  const ops = String(await operationsPage(view(evil)))
  const metrics = String(
    await metricsPage({
      operator: { email: evil },
      weekly: EMPTY_WEEKLY,
    }),
  )
  for (const page of [ops, metrics]) {
    expect(page).not.toContain('<b>x</b>')
    expect(page).toContain('&lt;b&gt;x&lt;/b&gt;')
  }
})
