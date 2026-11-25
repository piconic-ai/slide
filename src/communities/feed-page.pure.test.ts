import { expect, test } from 'vitest'
import { feedPages } from './feed-page'

test.each([
  // page, total, previous, next
  [1, 0, null, null],
  [1, 24, null, null],
  [1, 25, null, 2],
  [2, 30, 1, null],
  [3, 30, 2, null],
  [50, 30, 2, null],
  [2, 0, 1, null],
] as const)(
  'F31-AC5: Given page %i of a list of %i slides, When the pages around are found, Then the previous is %s and the next is %s, a page past the end leading back to the last',
  (page, total, previous, next) => {
    expect(feedPages(page, total)).toEqual({ previous, next })
  },
)
