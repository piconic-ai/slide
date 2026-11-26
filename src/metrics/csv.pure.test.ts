import { expect, test } from 'vitest'
import { csvField, csvOf } from './csv'
import { metricsTable, type DailyTotal } from './table'
import { lastWeeks } from './weeks'

const weeks = lastWeeks(Date.parse('2026-11-26T20:17:00Z') / 1000, 3)
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

test.each([
  ['plain', 'plain'],
  ['', ''],
  ['a,b', '"a,b"'],
  ['say "hi"', '"say ""hi"""'],
  ['two\nlines', '"two\nlines"'],
  ['=1+1', "'=1+1"],
  ['+81 90', "'+81 90"],
  ['-2', "'-2"],
  ['@sum(a1)', "'@sum(a1)"],
  ['\tTab', "'\tTab"],
  ['=HYPERLINK("http://x","y")', `"'=HYPERLINK(""http://x"",""y"")"`],
  ['a=b', 'a=b'],
  ['日本語', '日本語'],
])(
  'F40-AC20: Given the field %j, When it is written to CSV, Then it is %j',
  (value, written) => {
    expect(csvField(value)).toBe(written)
  },
)

test('F40-AC20: Given the table, When it is written to CSV, Then the header names the weeks by their Mondays and each row has a field for each week', () => {
  const table = metricsTable(weeks, [total({})], [1, 2, 3])
  const lines = csvOf(table).split('\r\n')
  expect(lines[0]).toBe('区分,項目,2026-11-09,2026-11-16,2026-11-23')
  expect(lines.at(-1)).toBe('')
  for (const line of lines.slice(0, -1))
    expect(line.split(',').length).toBeGreaterThanOrEqual(5)
  expect(lines).toContain(
    '使われているか,スライドを置いた作者の数(D1 から数えた値),1,2,3',
  )
  expect(lines).toContain('どこで詰まるか,ログインのコードを送った数,0,0,10')
})

test('F40-AC19, F40-AC20: Given a row with a share, When it is written, Then the line of the shares in percent follows it, and a row without one has no such line', () => {
  const table = metricsTable(
    weeks,
    [
      total({}),
      total({ event: 'login_code_entered', detail: 'accepted', events: 7 }),
    ],
    [0, 0, 0],
  )
  const lines = csvOf(table).split('\r\n')
  const at = lines.indexOf(
    'どこで詰まるか,コードが入れられた数(合っていた),0,0,7',
  )
  expect(at).toBeGreaterThan(0)
  expect(lines[at + 1]).toBe(
    'どこで詰まるか,コードが入れられた数(合っていた)(割合 %),,,70',
  )
  expect(
    lines.filter((line) => line.includes('(割合 %)')).length,
  ).toBeGreaterThan(0)
  expect(
    lines.some((line) =>
      line.startsWith('使われているか,置かれたスライド(割合'),
    ),
  ).toBe(false)
})

test('F40-AC20: Given a duration, When it is written, Then it is in minutes with one decimal, and empty when there is none', () => {
  const table = metricsTable(
    weeks,
    [total({ event: 'deck_published', events: 3, valueSum: 1000 })],
    [0, 0, 0],
  )
  expect(csvOf(table)).toContain('どこで詰まるか,公開までの時間(平均),,,5.6')
})

test('F40-AC20: Given hostile words in the table, When it is written, Then no field is read as a formula and the file keeps its shape', () => {
  const table = metricsTable(
    weeks,
    [
      total({
        event: 'help_search_empty',
        detail: '=cmd|"/c calc"!A1',
        events: 1,
      }),
      total({ referrer: 'a,b"c\nd.example', event: 'deck_opened', events: 1 }),
    ],
    [0, 0, 0],
  )
  const text = csvOf(table)
  // Quotes and commas are quoted, a line break stays inside its quotes.
  expect(text).toContain(
    'ヘルプで解決するか,"0 件だった検索の語: =cmd|""/c calc""!A1",0,0,1',
  )
  expect(text).toContain('どこから来るか,"参照元: a,b""c\nd.example",0,0,1')
  // Read back as CSV, every record has the same number of fields.
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      record.push(field)
      field = ''
    } else if (char === '\r' && text[i + 1] === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
      i += 1
    } else field += char
  }
  expect(records.length).toBeGreaterThan(20)
  for (const fields of records) expect(fields).toHaveLength(5)
})
