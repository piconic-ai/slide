import { expect, test } from 'vitest'
import { metricsPage } from './metrics-page'
import { operationsPage, type OperationsView } from './operations-pages'

const view = (email = 'op@example.com'): OperationsView => ({
  operator: { email },
  maintenance: { kind: 'pending' },
  signups: { kind: 'pending' },
  email: { kind: 'not_configured' },
  backups: { kind: 'pending' },
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
  // The frames of the alerts and of the email addresses are built; the other three are not yet.
  expect(page.match(/準備中です。/g)).toHaveLength(3)
  expect(page.match(/<h1>/g)).toHaveLength(1)
  expect(page).toContain('<title>運用 - ')
})

test('Given an operator address with markup, When either page is drawn, Then it is escaped', async () => {
  const evil = '<b>x</b>@example.com'
  const ops = String(await operationsPage(view(evil)))
  const metrics = String(
    await metricsPage({
      operator: { email: evil },
      weekly: { kind: 'pending' },
    }),
  )
  for (const page of [ops, metrics]) {
    expect(page).not.toContain('<b>x</b>')
    expect(page).toContain('&lt;b&gt;x&lt;/b&gt;')
  }
})

test('Given the metrics page, When drawn, Then it has one heading, an empty frame and no raw color', async () => {
  const page = String(
    await metricsPage({
      operator: { email: 'op@example.com' },
      weekly: { kind: 'pending' },
    }),
  )
  expect(page).toContain('<h1>計測</h1>')
  expect(page).toContain('準備中です。')
  expect(page).toContain('<title>計測 - ')
  expect(page).toContain('aria-current="page"')
})
