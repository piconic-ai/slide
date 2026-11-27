import { describe, expect, it } from 'vitest'
import { READING_SOURCE } from './reading'

// The text the page script holds, run with plain values.
const { pageIn, requestedIn, numberOf, pageOfSlide, slideOfPage } =
  new Function(
    `${READING_SOURCE}; return { numberOf, pageIn, requestedIn, pageOfSlide, slideOfPage }`,
  )() as {
    numberOf: (text: string) => number | null
    pageIn: (search: string, hash: string) => number | null
    requestedIn: (hash: string) => number | null
    pageOfSlide: (columns: number[], h: number, v: number) => number | null
    slideOfPage: (
      columns: number[],
      page: number,
    ) => { h: number; v: number } | null
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

describe('pageOfSlide and slideOfPage: reveal.js slides in reading order', () => {
  const five = [1, 1, 1, 1, 1]

  it.each([0, 1, 2, 3, 4])(
    'Given five columns of one slide, When column %i is on show, Then its page is one more, and it opens from that page',
    (h) => {
      expect(pageOfSlide(five, h, 0)).toBe(h + 1)
      expect(slideOfPage(five, h + 1)).toEqual({ h, v: 0 })
    },
  )

  it.each([
    ['a column past the end', 5, 0],
    ['a negative column', -1, 0],
    ['a slide below a column of one', 2, 1],
    ['a negative row', 2, -1],
    ['a fraction', 1.5, 0],
    ['no number', Number.NaN, 0],
    ['undefined', undefined as unknown as number, 0],
  ])('Given %s, When its page is asked, Then there is none', (_, h, v) => {
    expect(pageOfSlide(five, h, v)).toBeNull()
  })

  it.each([
    ['past the last page', 6, { h: 4, v: 0 }],
    ['far past the last page', 9999, { h: 4, v: 0 }],
  ])(
    'Given a page %s, When it is opened, Then the last slide is the one',
    (_, page, slide) => {
      expect(slideOfPage(five, page)).toEqual(slide)
    },
  )

  it('Given a deck with no slide, When a page is asked, Then there is none', () => {
    expect(slideOfPage([], 1)).toBeNull()
    expect(pageOfSlide([], 0, 0)).toBeNull()
  })
})

describe('pageOfSlide and slideOfPage: slides one above the other', () => {
  // Column 1 holds one slide, column 2 three, column 3 one.
  const columns = [1, 3, 1]

  it.each([
    [0, 0, 1],
    [1, 0, 2],
    [1, 1, 3],
    [1, 2, 4],
    [2, 0, 5],
  ])(
    'F03-AC199: Given columns of 1, 3 and 1 slides, When slide %i/%i is on show, Then its page is %i, and that page opens it',
    (h, v, page) => {
      expect(pageOfSlide(columns, h, v)).toBe(page)
      expect(slideOfPage(columns, page)).toEqual({ h, v })
    },
  )

  it('F03-AC201: Given the bottom of the column, When the page of the next column is asked, Then the numbers do not skip', () => {
    expect(pageOfSlide(columns, 1, 2)).toBe(4)
    expect(pageOfSlide(columns, 2, 0)).toBe(5)
  })

  it('Given every place of a deck, When pages are taken in order, Then each page is used once and opens its own place', () => {
    const shape = [2, 1, 3, 1]
    const pages: number[] = []
    for (const [h, below] of shape.entries())
      for (let v = 0; v < below; v++) pages.push(pageOfSlide(shape, h, v)!)
    expect(pages).toEqual([1, 2, 3, 4, 5, 6, 7])
    for (const page of pages)
      expect(
        pageOfSlide(
          shape,
          slideOfPage(shape, page)!.h,
          slideOfPage(shape, page)!.v,
        ),
      ).toBe(page)
  })
})
