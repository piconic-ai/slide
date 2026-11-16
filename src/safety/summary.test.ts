import { expect, test } from 'vitest'
import { PAGES_SHOWN, ROWS_SHOWN, summarize } from './summary'
import type { StoredKind, Traffic } from './traffic'

const BOUNDS = { kept: 600, keptPerGroup: 150 }
const seen = (
  kind: StoredKind,
  host: string,
  path: string,
  page = -1,
): Traffic => ({
  kind,
  host,
  path,
  page,
})

test('Given nothing reported, When summarized, Then there are no rows and nothing more', () => {
  expect(summarize([], BOUNDS)).toEqual({ rows: [], more: false })
})

test('Given many files of one kind from one host, When summarized, Then they make one row that shows the first and counts the others', () => {
  const summary = summarize(
    [
      seen('font', 'fonts.example', '/a.woff2', 0),
      seen('font', 'fonts.example', '/b.woff2', 0),
      seen('font', 'fonts.example', '/c.woff2', 0),
      // The same file seen again on another page is not another file.
      seen('font', 'fonts.example', '/a.woff2', 4),
    ],
    BOUNDS,
  )
  expect(summary.rows).toEqual([
    {
      kind: 'font',
      host: 'fonts.example',
      path: '/a.woff2',
      others: 2,
      full: false,
      pages: [4],
      opening: true,
    },
  ])
  expect(summary.more).toBe(false)
})

test('Given one host used in two ways, When summarized, Then each way has its own row', () => {
  const { rows } = summarize(
    [
      seen('script', 'a.example', '/x.js', 2),
      seen('data', 'a.example', '/v1', 2),
    ],
    BOUNDS,
  )
  expect(rows.map((row) => row.kind)).toEqual(['script', 'data'])
})

test('Given rows of different pages, When summarized, Then what happened on opening comes first, then pages in order, and unknown pages last', () => {
  const { rows } = summarize(
    [
      seen('image', 'unknown.example', '/'),
      seen('image', 'nine.example', '/', 9),
      seen('image', 'three.example', '/', 3),
      seen('image', 'opening.example', '/', 0),
      seen('data', 'three-later.example', '/', 3),
    ],
    BOUNDS,
  )
  expect(rows.map((row) => row.host)).toEqual([
    'opening.example',
    'three.example',
    'three-later.example',
    'nine.example',
    'unknown.example',
  ])
  expect(rows.at(-1)).toMatchObject({ pages: [], opening: false })
})

test('Given a row seen on pages out of order and without a page, When summarized, Then its pages ascend and each appears once', () => {
  const { rows } = summarize(
    [
      seen('image', 'a.example', '/', 7),
      seen('image', 'a.example', '/'),
      seen('image', 'a.example', '/', 2),
      seen('image', 'a.example', '/b', 7),
    ],
    BOUNDS,
  )
  expect(rows[0]?.pages).toEqual([2, 7])
  expect(PAGES_SHOWN).toBeGreaterThan(2)
})

test('Given a host and kind holding as many records as are kept, When summarized, Then its row says the count is a lower bound', () => {
  const records = Array.from({ length: 3 }, (_, index) =>
    seen('font', 'fonts.example', `/${index}`),
  )
  const [row] = summarize(records, { kept: 600, keptPerGroup: 3 }).rows
  expect(row).toMatchObject({ others: 2, full: true })
  expect(summarize(records, { kept: 600, keptPerGroup: 4 }).rows[0]?.full).toBe(
    false,
  )
})

test('Given as many records as a deployment keeps, When summarized, Then it says more was reported', () => {
  const records = [
    seen('image', 'a.example', '/'),
    seen('data', 'b.example', '/'),
  ]
  expect(summarize(records, { kept: 2, keptPerGroup: 150 }).more).toBe(true)
  expect(summarize(records, { kept: 3, keptPerGroup: 150 }).more).toBe(false)
})

test('Given more rows than a table shows, When summarized, Then the first are shown and it says more was reported', () => {
  const records = Array.from({ length: ROWS_SHOWN + 1 }, (_, index) =>
    seen('image', `h${index}.example`, '/'),
  )
  const summary = summarize(records, BOUNDS)
  expect(summary.rows).toHaveLength(ROWS_SHOWN)
  expect(summary.rows.at(-1)?.host).toBe(`h${ROWS_SHOWN - 1}.example`)
  expect(summary.more).toBe(true)
})

test('Given a browser’s report without a page and a sighting of the same URL, When summarized, Then the row takes the sighting’s pages and the sighting makes no row', () => {
  const { rows } = summarize(
    [
      seen('style', 'fonts.example', '/css2'),
      seen('seen', 'fonts.example', '/css2', 0),
      seen('seen', 'fonts.example', '/css2', 6),
      // A sighting of another URL lends nothing.
      seen('image', 'fonts.example', '/logo.png'),
      seen('seen', 'fonts.example', '/other.png', 4),
      seen('seen', 'alone.example', '/', 2),
    ],
    BOUNDS,
  )
  expect(rows).toEqual([
    expect.objectContaining({ kind: 'style', pages: [6], opening: true }),
    expect.objectContaining({ kind: 'image', pages: [], opening: false }),
  ])
})

test('Given a sighting that has no page either, When summarized, Then the row’s page stays unknown', () => {
  const { rows } = summarize(
    [seen('style', 'a.example', '/a.css'), seen('seen', 'a.example', '/a.css')],
    BOUNDS,
  )
  expect(rows).toEqual([
    expect.objectContaining({ kind: 'style', pages: [], opening: false }),
  ])
})
