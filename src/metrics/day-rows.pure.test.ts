import { expect, test } from 'vitest'
import { MAX_DAY_ROWS } from './day-query'
import { parseDayResponse } from './day-rows'

const row = (extra: Record<string, unknown> = {}) => ({
  event: 'deck_opened',
  detail: 'page',
  referrer: 'news.example',
  lang: 'ja',
  screen: '',
  events: 12,
  value_sum: 0,
  ...extra,
})

test('F40-AC17: Given an answer with rows, When it is read, Then each row is kept with its count and value', () => {
  expect(
    parseDayResponse({
      meta: [],
      rows: 2,
      data: [
        row(),
        row({ event: 'deck_published', value_sum: 540.5, events: 3 }),
      ],
    }),
  ).toEqual({
    rows: [
      {
        event: 'deck_opened',
        detail: 'page',
        referrer: 'news.example',
        lang: 'ja',
        screen: '',
        events: 12,
        valueSum: 0,
      },
      {
        event: 'deck_published',
        detail: 'page',
        referrer: 'news.example',
        lang: 'ja',
        screen: '',
        events: 3,
        valueSum: 540.5,
      },
    ],
    truncated: false,
  })
})

test('F40-AC17: Given counts written as strings, as 64-bit integers can come, When it is read, Then they are numbers', () => {
  const { rows } = parseDayResponse({
    data: [row({ events: '4096', value_sum: '12.5' })],
  })
  expect(rows[0]).toMatchObject({ events: 4096, valueSum: 12.5 })
})

test('F40-AC17: Given a count with a fraction, When it is read, Then it is rounded to a whole number', () => {
  expect(
    parseDayResponse({ data: [row({ events: 2.6 })] }).rows[0]?.events,
  ).toBe(3)
})

test('F40-AC17: Given a language that is neither ja nor en, When it is read, Then it is kept as none', () => {
  expect(parseDayResponse({ data: [row({ lang: 'fr' })] }).rows[0]?.lang).toBe(
    '',
  )
})

test('F40-AC17: Given an answer with no rows, When it is read, Then it is an empty day', () => {
  expect(parseDayResponse({ data: [] })).toEqual({ rows: [], truncated: false })
})

test('F40-AC17: Given as many rows as a copy holds, When it is read, Then it says it was cut', () => {
  const data = Array.from({ length: MAX_DAY_ROWS }, (_, i) =>
    row({ detail: `w${i}` }),
  )
  expect(parseDayResponse({ data }).truncated).toBe(true)
  expect(parseDayResponse({ data: data.slice(1) }).truncated).toBe(false)
})

test.each([
  ['null', null],
  ['a string', 'nope'],
  ['no data', { rows: 0 }],
  ['data not a list', { data: {} }],
  ['a row that is no object', { data: ['x'] }],
  ['no event', { data: [row({ event: undefined })] }],
  ['an empty event', { data: [row({ event: '' })] }],
  ['an event too long', { data: [row({ event: 'x'.repeat(41) })] }],
  ['a detail too long', { data: [row({ detail: 'x'.repeat(201) })] }],
  ['a negative count', { data: [row({ events: -1 })] }],
  ['a count that is text', { data: [row({ events: 'many' })] }],
  ['a count that is null', { data: [row({ events: null })] }],
  ['an infinite count', { data: [row({ events: Number.POSITIVE_INFINITY })] }],
  ['a negative value', { data: [row({ value_sum: -5 })] }],
])(
  'F40-AC17: Given an answer with %s, When it is read, Then the whole answer is refused instead of copied halfway',
  (_name, body) => {
    expect(() => parseDayResponse(body)).toThrow()
  },
)
