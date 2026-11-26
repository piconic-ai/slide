import { expect, test } from 'vitest'
import { metricsTable, type DailyTotal } from '../metrics/table'
import { lastWeeks } from '../metrics/weeks'
import {
  metricsPage,
  METRICS_CSV_PATH,
  type MetricsFrameView,
} from './metrics-page'

const weeks = lastWeeks(Date.parse('2026-11-26T20:17:00Z') / 1000)
const total = (extra: Partial<DailyTotal>): DailyTotal => ({
  day: '2026-11-25',
  event: 'login_code_sent',
  detail: '',
  referrer: '',
  screen: '',
  events: 10,
  valueSum: 0,
  ...extra,
})

const frame = (
  totals: readonly DailyTotal[] = [],
  extra: Partial<MetricsFrameView> = {},
): MetricsFrameView => ({
  kind: 'table',
  table: metricsTable(
    weeks,
    totals,
    weeks.map(() => 0),
  ),
  missing: [],
  lastCopy: null,
  ...extra,
})

const draw = async (weekly: MetricsFrameView, email = 'op@example.com') =>
  String(await metricsPage({ operator: { email }, weekly }))

/** The page's text with every run of white space made one space. */
const flat = async (weekly: MetricsFrameView) =>
  (await draw(weekly)).replace(/\s+/g, ' ')

test('F40-AC18: Given the metrics page, When drawn, Then it has one heading, one frame with its heading, the navigation and a table of 12 weeks', async () => {
  const page = await draw(frame())
  expect(page.match(/<h1>/g)).toHaveLength(1)
  expect(page).toContain('<h1>計測</h1>')
  expect(page).toContain('<title>計測 - ')
  expect(page).toContain('aria-current="page"')
  expect(page).toContain('<section id="weekly">')
  expect(page).toContain('<h2>週ごとの数</h2>')
  // The first column and then a column for each of the 12 weeks.
  const head = /<thead>([\s\S]*?)<\/thead>/.exec(page)?.[1] ?? ''
  expect(head.match(/<th scope="col"/g)).toHaveLength(13)
  expect(page).toContain('9/7')
  expect(page).toContain('11/23')
  expect(page).not.toContain('準備中です。')
})

test('F40-AC18: Given the table, When drawn, Then every row has a header cell with scope row, and every column a header with scope col', async () => {
  const page = await draw(frame())
  const rows = page.match(/<th scope="row">/g) ?? []
  const labelled = metricsTable(
    weeks,
    [],
    weeks.map(() => 0),
  ).groups.flatMap((g) => g.rows).length
  expect(rows).toHaveLength(labelled)
  expect(page).toContain('scope="colgroup"')
  expect(page).toContain('class="metrics-table"')
  // The table is inside the box that scrolls sideways, not the page.
  expect(page).toMatch(
    /<div class="table-scroll">\s*<table class="metrics-table"/,
  )
})

test('F40-AC19: Given logins, When drawn, Then the count and its share are side by side in the one cell, and a week without a share shows the number alone', async () => {
  const page = await draw(
    frame([
      total({ events: 10 }),
      total({ event: 'login_code_entered', detail: 'accepted', events: 8 }),
      total({ event: 'upload_started', events: 3 }),
      total({ event: 'upload_finished', events: 1 }),
    ]),
  )
  expect(page).toContain('<td>8 (80%)</td>')
  expect(page).toContain('<td>1 (33%)</td>')
  expect(page).toContain('<td>10</td>')
})

test('F40-AC7: Given a wait, When drawn, Then it is in minutes, and a week with none shows a dash', async () => {
  const page = await draw(
    frame([total({ event: 'deck_published', events: 2, valueSum: 1230 })]),
  )
  expect(page).toContain('<td>10.3 分</td>')
  expect(page).toContain('<td>—</td>')
})

test('F40-AC19: Given thousands, When drawn, Then the numbers carry separators', async () => {
  const page = await draw(frame([total({ events: 12345 })]))
  expect(page).toContain('<td>12,345</td>')
})

test('F40-AC20: Given the page, When drawn, Then it links to the CSV as a download, in plain words and not as a button', async () => {
  const page = await draw(frame())
  expect(METRICS_CSV_PATH).toBe('/metrics.csv')
  expect(page).toMatch(
    /<a href="\/metrics\.csv"\s+download\s*>CSV で書き出す<\/a>/,
  )
  expect(
    /<a [^>]*class=/.test(
      /<a href="\/metrics\.csv"[^>]*>/.exec(page)?.[0] ?? 'class=',
    ),
  ).toBe(false)
})

test('F40-AC22, F40-AC23: Given settings that are missing, When drawn, Then the note right under the heading names them with the place of the steps', async () => {
  const page = await draw(
    frame([], { missing: ['ANALYTICS_READ_TOKEN', 'ANALYTICS_ACCOUNT_ID'] }),
  )
  expect(page).toContain('未設定:')
  expect(page).toContain('<code>ANALYTICS_READ_TOKEN</code>')
  expect(page).toContain('<code>ANALYTICS_ACCOUNT_ID</code>')
  expect(page).toContain('<code>docs/dev/metrics-setup.md</code>')
  expect(page.indexOf('<h2>週ごとの数</h2>')).toBeLessThan(
    page.indexOf('未設定:'),
  )
  // The table is still drawn: what D1 holds is worth showing.
  expect(page).toContain('<table')
})

test('F40-AC22: Given nothing missing, When drawn, Then there is no note of a missing setting', async () => {
  expect(await draw(frame())).not.toContain('未設定')
})

test('F40-AC17: Given the newest copied day, When drawn, Then it is shown, and so is a cut day; with none copied it says so', async () => {
  expect(
    await flat(
      frame([], { lastCopy: { day: '2026-11-25', truncated: false } }),
    ),
  ).toContain('最後に写した日: 2026-11-25')
  expect(
    await flat(frame([], { lastCopy: { day: '2026-11-25', truncated: true } })),
  ).toContain('上位だけを写しました')
  expect(await flat(frame())).toContain('まだ写していません')
})

test('F40-AC18: Given hostile text in a host, a word and the address, When drawn, Then it is escaped', async () => {
  const page = await draw(
    frame([
      total({
        event: 'deck_opened',
        referrer: '<img src=x onerror=alert(1)>.example',
      }),
      total({
        event: 'help_search_empty',
        detail: '"><script>alert(1)</script>',
      }),
    ]),
    '<b>x</b>@example.com',
  )
  expect(page).not.toContain('<img src=x')
  expect(page).not.toContain('<script>alert(1)')
  expect(page).not.toContain('<b>x</b>')
  expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;.example')
})

test('F40-AC25: Given the page, When drawn, Then no inline width is set on the table, and the box that scrolls is the one the other operator tables use', async () => {
  const page = await draw(frame())
  expect(page).not.toMatch(/<table[^>]*style=/)
  expect(page).toContain('class="table-scroll"')
})
