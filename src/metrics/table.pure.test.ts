import { expect, test } from 'vitest'
import {
  metricsTable,
  TOP_ROWS,
  weekLabel,
  type DailyTotal,
  type Row,
} from './table'
import { lastWeeks } from './weeks'

const NOW = Date.parse('2026-11-26T20:17:00Z') / 1000
const weeks = lastWeeks(NOW)
const NEWEST = '2026-11-25'
const PREVIOUS = '2026-11-18'
const AUTHORS = weeks.map((_, i) => i)

const total = (extra: Partial<DailyTotal>): DailyTotal => ({
  day: NEWEST,
  event: 'deck_opened',
  detail: '',
  referrer: '',
  screen: '',
  events: 1,
  valueSum: 0,
  ...extra,
})

const rowsOf = (totals: readonly DailyTotal[]) =>
  Object.fromEntries(
    metricsTable(weeks, totals, AUTHORS).groups.flatMap((group) =>
      group.rows.map((row) => [row.label, row] as const),
    ),
  ) as Record<string, Row>
const last = (row: Row | undefined) => row?.cells.at(-1)
const nth = (row: Row | undefined, i: number) => row?.cells[i]

test('F40-AC18: Given no data, When the table is made, Then it has the groups of D-72 in order, a cell for each week in every row, and no number but the authors', () => {
  const table = metricsTable(weeks, [], AUTHORS)
  expect(table.groups.map((group) => group.heading)).toEqual([
    '使われているか',
    'どこで詰まるか',
    '何が使われているか',
    'どこから来るか',
    'ヘルプで解決するか',
    '壊れていないか',
  ])
  for (const group of table.groups)
    for (const row of group.rows) {
      expect(row.cells).toHaveLength(12)
      if (row.label.startsWith('スライドを置いた作者の数')) continue
      for (const cell of row.cells)
        expect(cell.value === null || cell.value === 0).toBe(true)
    }
  expect(
    rowsOf([])['スライドを置いた作者の数(D1 から数えた値)']?.cells.map(
      (c) => c.value,
    ),
  ).toEqual(AUTHORS)
})

test('F40-AC18: Given events on different days, When they are added up, Then each week holds the days of its Monday to its Sunday, and days outside the weeks hold nothing', () => {
  const rows = rowsOf([
    total({ event: 'upload_finished', day: '2026-11-22', events: 2 }),
    total({ event: 'upload_finished', day: '2026-11-23', events: 5 }),
    total({ event: 'upload_finished', day: '2026-11-29', events: 1 }),
    total({ event: 'upload_finished', day: '2026-11-30', events: 100 }),
    total({ event: 'upload_finished', day: '2020-01-01', events: 100 }),
  ])
  const row = rows['置かれたスライド']
  expect(nth(row, 10)?.value).toBe(2)
  expect(nth(row, 11)?.value).toBe(6)
  expect(row?.cells.reduce((sum, c) => sum + (c.value ?? 0), 0)).toBe(8)
})

test('F40-AC19: Given codes sent and entered, When the table is made, Then each count has its share of the codes sent, and a week with none sent has no share', () => {
  const rows = rowsOf([
    total({ event: 'login_code_sent', events: 10 }),
    total({ event: 'login_code_entered', detail: 'accepted', events: 8 }),
    total({ event: 'login_code_entered', detail: 'rejected', events: 3 }),
    // A week where codes were entered and none are on record as sent.
    total({
      event: 'login_code_entered',
      detail: 'accepted',
      day: PREVIOUS,
      events: 2,
    }),
  ])
  expect(last(rows['ログインのコードを送った数'])).toEqual({
    value: 10,
    share: null,
  })
  expect(last(rows['コードが入れられた数(合っていた)'])).toEqual({
    value: 8,
    share: 0.8,
  })
  expect(last(rows['コードが入れられた数(合っていなかった)'])).toEqual({
    value: 3,
    share: 0.3,
  })
  expect(nth(rows['コードが入れられた数(合っていた)'], 10)).toEqual({
    value: 2,
    share: null,
  })
})

test('F40-AC19: Given uploads started and finished, When the table is made, Then the finished has its share of the started, and a share over one is kept as it is', () => {
  const rows = rowsOf([
    total({ event: 'upload_started', events: 4 }),
    total({ event: 'upload_finished', events: 3 }),
    total({ event: 'upload_started', day: PREVIOUS, events: 1 }),
    total({ event: 'upload_finished', day: PREVIOUS, events: 2 }),
  ])
  expect(last(rows['置く操作が終わった数'])).toEqual({ value: 3, share: 0.75 })
  expect(nth(rows['置く操作が終わった数'], 10)).toEqual({ value: 2, share: 2 })
})

test('F40-AC6: Given refusals of different reasons, When the table is made, Then each reason has its own row', () => {
  const rows = rowsOf([
    total({ event: 'upload_refused', detail: 'file_too_large', events: 2 }),
    total({ event: 'upload_refused', detail: 'deck_limit', events: 1 }),
    total({ event: 'upload_refused', detail: 'something_new', events: 9 }),
  ])
  expect(
    last(rows['置くのを断った数(1 つのファイルが大きすぎた)'])?.value,
  ).toBe(2)
  expect(
    last(rows['置くのを断った数(持てるスライドの数を超えた)'])?.value,
  ).toBe(1)
  expect(last(rows['置くのを断った数(ファイルの数が多すぎた)'])?.value).toBe(0)
  const all = Object.keys(rows).filter((label) =>
    label.startsWith('置くのを断った数'),
  )
  expect(all).toHaveLength(7)
})

test('F40-AC7: Given publications with their waits, When the table is made, Then the wait is the weighted average in minutes, and none when nothing was published', () => {
  const rows = rowsOf([
    total({ event: 'deck_published', events: 2, valueSum: 600 }),
    total({
      event: 'deck_published',
      events: 2,
      valueSum: 1800,
      day: '2026-11-24',
    }),
  ])
  const wait = rows['公開までの時間(平均)']
  expect(wait?.unit).toBe('minutes')
  // 2400 seconds over 4 events is 10 minutes, not an average of day averages.
  expect(last(wait)?.value).toBe(10)
  expect(nth(wait, 0)).toEqual({ value: null, share: null })
})

test('F40-AC11: Given views by page and by embed, When the table is made, Then they are separate rows', () => {
  const rows = rowsOf([
    total({ detail: 'page', events: 7 }),
    total({ detail: 'embed', events: 3 }),
  ])
  expect(last(rows['開かれたスライド(ページ)'])?.value).toBe(7)
  expect(last(rows['開かれたスライド(埋め込み)'])?.value).toBe(3)
})

test('F40-AC10: Given views from several referrers, When the table is made, Then the hosts are rows by their total over the weeks, with the service itself and no referrer apart', () => {
  const rows = rowsOf([
    total({ referrer: 'news.example', events: 5 }),
    total({ referrer: 'news.example', events: 4, day: PREVIOUS }),
    total({ referrer: 'blog.example', events: 6 }),
    total({ referrer: 'internal', events: 9 }),
    total({ referrer: '', events: 11 }),
  ])
  expect(last(rows['開かれたスライド(参照元なし)'])?.value).toBe(11)
  expect(last(rows['開かれたスライド(サービスの中から)'])?.value).toBe(9)
  const hosts = Object.keys(rows).filter((label) =>
    label.startsWith('参照元: '),
  )
  expect(hosts).toEqual(['参照元: news.example', '参照元: blog.example'])
  expect(last(rows['参照元: news.example'])?.value).toBe(5)
  expect(nth(rows['参照元: news.example'], 10)?.value).toBe(4)
})

test('F40-AC12, F40-AC13, F40-AC14: Given more than ten words, articles and routes, When the table is made, Then each list shows the ten most counted, the most first, ties by name', () => {
  const many = Array.from({ length: 15 }, (_, i) => i)
  const rows = rowsOf([
    ...many.map((i) =>
      total({
        event: 'help_search_empty',
        detail: `w${String(i).padStart(2, '0')}`,
        events: i + 1,
      }),
    ),
    ...many.map((i) =>
      total({ event: 'help_article_viewed', detail: `a/b${i}`, events: 1 }),
    ),
    ...many.map((i) =>
      total({
        event: 'screen_error',
        detail: 'server_error',
        screen: `/r${i}`,
        events: i + 1,
      }),
    ),
    total({ event: 'help_to_contact', events: 4 }),
  ])
  const words = Object.keys(rows).filter((label) =>
    label.startsWith('0 件だった検索の語: '),
  )
  expect(words).toHaveLength(TOP_ROWS)
  expect(words[0]).toBe('0 件だった検索の語: w14')
  expect(words[9]).toBe('0 件だった検索の語: w05')
  const articles = Object.keys(rows).filter((label) =>
    label.startsWith('記事の閲覧: '),
  )
  expect(articles).toHaveLength(TOP_ROWS)
  // All tied at one: by name, so a stable list.
  expect(articles.slice(0, 3)).toEqual([
    '記事の閲覧: a/b0',
    '記事の閲覧: a/b1',
    '記事の閲覧: a/b10',
  ])
  const errors = Object.keys(rows).filter((label) =>
    label.startsWith('エラーのページ: '),
  )
  expect(errors).toHaveLength(TOP_ROWS)
  expect(errors[0]).toBe('エラーのページ: server_error /r14')
  expect(last(rows['お問い合わせに進んだ数'])?.value).toBe(4)
})

test('F40-AC9: Given tool calls, When the table is made, Then each tool has a row', () => {
  const rows = rowsOf([
    total({ event: 'mcp_tool_called', detail: 'put_slide', events: 3 }),
    total({ event: 'mcp_tool_called', detail: 'list_slides', events: 8 }),
  ])
  expect(
    Object.keys(rows).filter((label) =>
      label.startsWith('AI エージェントの道具: '),
    ),
  ).toEqual([
    'AI エージェントの道具: list_slides',
    'AI エージェントの道具: put_slide',
  ])
})

test('F40-AC8: Given the uses of the other features, When the table is made, Then each has its own row and an export has a row for each kind', () => {
  const rows = rowsOf([
    total({ event: 'article_published', events: 1 }),
    total({ event: 'related_link_added', events: 2 }),
    total({ event: 'citation_made', events: 3 }),
    total({ event: 'oembed_served', events: 4 }),
    total({ event: 'community_created', events: 5 }),
    total({ event: 'community_followed', events: 6 }),
    total({ event: 'author_followed', events: 7 }),
    total({ event: 'export_downloaded', detail: 'account', events: 8 }),
    total({ event: 'export_downloaded', detail: 'slide', events: 9 }),
  ])
  expect(
    [
      '公開された記事',
      '足された関連リンク',
      'ほかのスライドを引用した版',
      '埋め込みの方法を答えた数',
      '作られたコミュニティ',
      'コミュニティのフォロー',
      '作者のフォロー',
      '書き出し(アカウントの情報)',
      '書き出し(スライド(zip))',
    ].map((label) => last(rows[label])?.value),
  ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
})

test('F40-AC18: Given hostile text in a host, a word and a route, When the table is made, Then it is kept as the text it is, for the page and the CSV to treat', () => {
  const rows = rowsOf([
    total({ referrer: '<script>x</script>.example', events: 1 }),
    total({
      event: 'help_search_empty',
      detail: '=HYPERLINK("http://x")',
      events: 1,
    }),
  ])
  expect(Object.keys(rows)).toContain('参照元: <script>x</script>.example')
  expect(Object.keys(rows)).toContain(
    '0 件だった検索の語: =HYPERLINK("http://x")',
  )
})

test('F40-AC18: Given a week, When it is named, Then the name is its Monday as month and day', () => {
  expect(
    weekLabel({ start: '2026-11-23' as never, end: '2026-11-29' as never }),
  ).toBe('11/23')
  expect(
    weekLabel({ start: '2027-01-04' as never, end: '2027-01-10' as never }),
  ).toBe('1/4')
})
