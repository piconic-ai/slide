import { expect, test } from 'vitest'
import { DATASET, dayQuery, MAX_DAY_ROWS } from './day-query'

test('F40-AC17: Given a day, When its query is made, Then it reads that UTC day of the dataset, summed with the sample interval, as JSON', () => {
  const sql = dayQuery(DATASET, '2026-11-25')
  expect(sql).toContain(`FROM ${DATASET}`)
  expect(sql).toContain("timestamp >= toDateTime('2026-11-25 00:00:00')")
  expect(sql).toContain("timestamp < toDateTime('2026-11-26 00:00:00')")
  expect(sql).toContain('SUM(_sample_interval) AS events')
  expect(sql).toContain('SUM(double1 * _sample_interval) AS value_sum')
  expect(sql).toContain('GROUP BY event, detail, referrer, lang, screen')
  expect(sql).toContain(`LIMIT ${MAX_DAY_ROWS}`)
  expect(sql.trimEnd().endsWith('FORMAT JSON')).toBe(true)
  // No unsampled count: a count of rows would miss what sampling dropped.
  expect(sql).not.toMatch(/\bcount\(/i)
})

test('F40-AC17: Given the last day of a month and of a year, When its query is made, Then the end of the window is the next day', () => {
  expect(dayQuery(DATASET, '2026-12-31')).toContain("'2027-01-01 00:00:00'")
  expect(dayQuery(DATASET, '2024-02-29')).toContain("'2024-03-01 00:00:00'")
})

test.each([
  '2026-11-25; DROP TABLE x',
  "2026-11-25' OR '1'='1",
  '2026-13-40',
  '',
  'today',
])(
  'F40-AC17: Given the day %j that is no day, When its query is made, Then it is refused, since the text is put into the SQL',
  (day) => {
    expect(() => dayQuery(DATASET, day)).toThrow(RangeError)
  },
)

test.each([
  '',
  'slide events',
  'slide_events; --',
  "a'b",
  '1abc',
  'x'.repeat(70),
])(
  'F40-AC17: Given the table name %j that is no name, When its query is made, Then it is refused',
  (table) => {
    expect(() => dayQuery(table, '2026-11-25')).toThrow(RangeError)
  },
)
