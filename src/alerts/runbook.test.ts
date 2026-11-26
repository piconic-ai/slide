import { readFile } from 'node:fs/promises'
import { beforeAll, expect, test } from 'vitest'
import { ALERT_URGENCY, runbookLink, type AlertKind } from './notice'
import { responseLogOf } from './response-log'

let book = ''
beforeAll(async () => {
  book = await readFile('docs/dev/alerts-runbook.md', 'utf8')
})

const kinds = Object.keys(ALERT_URGENCY) as AlertKind[]

/** The text of the section that starts at an anchor, up to the next anchor or the next `## `. */
function section(anchor: string) {
  const start = book.indexOf(`<a id="${anchor}"></a>`)
  if (start < 0) return null
  const rest = book.slice(start + 1)
  const end = rest.search(/<a id="|\n## /)
  return rest.slice(0, end < 0 ? undefined : end)
}

const anchorOf = (link: string) => link.slice(link.indexOf('#') + 1)

test.each(kinds)(
  'F39-AC21: Given the kind %s, When its steps are looked up by the link a notice carries, Then they hold what to look at first, the usual causes and how to go back',
  (kind) => {
    const text = section(anchorOf(runbookLink(kind)))
    expect(text, `no section for ${kind}`).not.toBeNull()
    expect(text).toContain('最初に見るもの')
    expect(text).toContain('よくある原因')
    expect(text).toContain('戻し方')
  },
)

test.each(['http-5xx', 'rate-limited', 'budget'])(
  'F39-AC21: Given the Cloudflare alert %s, When its steps are looked up, Then they hold the three parts as well',
  (anchor) => {
    const text = section(anchor)
    expect(text).not.toBeNull()
    for (const part of ['最初に見るもの', 'よくある原因', '戻し方'])
      expect(text).toContain(part)
  },
)

test('F39-AC21: Given the section of how to go back, When it is read, Then it has the previous version, the maintenance display and the Time Travel restore', () => {
  const text = book.slice(
    book.indexOf('\n## 戻し方'),
    book.indexOf('\n## わざと'),
  )
  expect(text).toContain('pnpm exec wrangler rollback')
  expect(text).toContain('wrangler secret put MAINTENANCE')
  expect(text).toContain('wrangler d1 time-travel restore slide')
})

test('F39-AC22: Given the setting of Cloudflare alerts, When it is read, Then it names the screens, the conditions and the destinations, and the log lines it gives are the ones the service writes', () => {
  for (const text of [
    'Observability',
    'Monitors',
    'SLO',
    '異常検知',
    'Budget alerts',
    'Billable Usage',
  ])
    expect(book).toContain(text)
  for (const amount of [10, 15, 20, 25, 30, 35, 40, 45, 50])
    expect(book).toContain(`| \`budget-${amount}\` | ${amount} |`)
  const five = JSON.stringify(responseLogOf('management', '/', 502)).replace(
    /,"origin":"management"/,
    '',
  )
  expect(five).toContain('http_5xx')
  expect(book).toContain('"event":"http_5xx"')
  expect(book).toContain('"event":"http_limited"')
  expect(book).toContain('99')
})

test('F39-AC23: Given the checks by a deliberate failure, When the table is read, Then each mechanism has a row: login mail, cron, report, Luma, D1 size, a quiet day, the watcher, a missing webhook, and the three of Cloudflare', () => {
  const table = book.slice(
    book.indexOf('\n## わざと'),
    book.indexOf('\n## ログと'),
  )
  for (const row of [
    '| ログインのメール(すぐ)',
    '| cron の失敗(翌日)',
    '| 通報(翌日)',
    '| Luma の配信の停止(翌日)',
    '| D1 の大きさ(翌日)',
    '| 知らせることがない日(翌日)',
    '| 見張りの Worker(すぐ)',
    '| webhook が未設定(すぐ)',
    '| 5xx の割合のアラート',
    '| 上限に当たった数のアラート',
    '| Budget alerts',
  ])
    expect(table, row).toContain(row)
})

test('F39-AC24: Given the steps for the logs, When they are read, Then they cover the Workers logs and the audit logs and leave a place for the periods found', () => {
  const part = book.slice(book.indexOf('\n## ログと'))
  expect(part).toContain('Workers のログ')
  expect(part).toContain('Audit Logs')
  expect(part).toContain('18 か月')
  expect(part).toContain('画面で確かめた値')
  expect(part).toContain('`(日数)`')
})

test('Given the runbook, When it is read, Then it carries no webhook address and no email address', () => {
  expect(book).not.toMatch(/discord\.com\/api\/webhooks\/\d/)
  expect(book).not.toMatch(/[\w.+-]+@(?!slide\.community)[\w-]+\.[a-z]{2,}/i)
})
