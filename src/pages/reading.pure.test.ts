import { describe, expect, it } from 'vitest'
import { READING_SOURCE } from './reading'

// The text the page script holds, run with plain values.
const { pageIn, requestedIn, numberOf } = new Function(
  `${READING_SOURCE}; return { numberOf, pageIn, requestedIn }`,
)() as {
  numberOf: (text: string) => number | null
  pageIn: (search: string, hash: string) => number | null
  requestedIn: (hash: string) => number | null
}

describe('pageIn: the page of a slide that gives no sign of its tool', () => {
  it.each([
    ['#3', 3],
    ['#1', 1],
    ['#9999', 9999],
    ['', 1],
    ['#', 1],
  ])(
    'F03-AC195: Given the fragment %j, When it is read, Then the page is %j',
    (hash, page) => {
      expect(pageIn('', hash)).toBe(page)
    },
  )

  it.each([
    '#0',
    '#10000',
    '#03',
    '#-1',
    '#1.5',
    '#/3',
    '#intro',
    '#2.1',
    '#3 ',
  ])(
    'F03-AC195: Given the fragment %j that is no page number, When it is read, Then nothing is told',
    (hash) => {
      expect(pageIn('', hash)).toBeNull()
    },
  )

  it.each([
    ['?slide=5', '#3', 5],
    ['?slide=5', '', 5],
    ['?a=1&slide=2', '#3', 2],
  ])(
    'F03-AC195: Given the query %j and the fragment %j, When it is read, Then the query is the page: %j',
    (search, hash, page) => {
      expect(pageIn(search, hash)).toBe(page)
    },
  )

  it.each(['?slide=', '?slide=abc', '?slide=0', '?slide=1.5', '?slide=-1'])(
    'F03-AC195: Given the query %j that is no page number, When it is read, Then nothing is told, even with a page in the fragment',
    (search) => {
      expect(pageIn(search, '#3')).toBeNull()
    },
  )
})

describe('requestedIn: the page a reader was sent to', () => {
  it.each([
    ['#3', 3],
    ['', null],
    ['#', null],
    ['#/3', null],
    ['#0', null],
    ['#intro', null],
  ])(
    'Given the fragment %j, When it is read, Then the request is %j',
    (hash, page) => {
      expect(requestedIn(hash)).toBe(page)
    },
  )
})

describe('numberOf', () => {
  it.each(['', ' 3', '3\n', '٣', '３', '0003'])(
    'Given %j, When it is read, Then it is not a page number',
    (text) => {
      expect(numberOf(text)).toBeNull()
    },
  )
})
