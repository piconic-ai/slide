import { expect, test } from 'vitest'
import {
  COPY_COST,
  PAGE_COST,
  PAGE_MAX,
  RUN_BUDGET,
  pageCost,
  pageLimit,
} from './limits'

test('F39-AC29: Given a whole budget, When the page is sized, Then it is the most a page may list', () => {
  expect(pageLimit(RUN_BUDGET)).toBe(PAGE_MAX)
})

test('F39-AC29: Given a small budget, When the page is sized, Then every object of the page could be copied within it', () => {
  for (let remaining = 0; remaining <= 40; remaining++) {
    const limit = pageLimit(remaining)
    expect(pageCost(limit)).toBeLessThanOrEqual(Math.max(remaining, PAGE_COST))
    // And no larger page would fit.
    if (limit > 0 && limit < PAGE_MAX)
      expect(pageCost(limit + 1)).toBeGreaterThan(remaining)
  }
})

test.each([
  ['nothing left', 0],
  ['less than a page costs', PAGE_COST - 1],
  ['a page and not one copy', PAGE_COST + COPY_COST - 1],
  ['a negative budget', -5],
  ['not a number', Number.NaN],
  ['infinite', Number.POSITIVE_INFINITY],
])(
  'F39-AC29: Given %s, When the page is sized, Then no page is listed',
  (_, remaining) => {
    expect(pageLimit(remaining)).toBe(0)
  },
)

test('F39-AC29: Given exactly one copy affordable, When the page is sized, Then it lists one object', () => {
  expect(pageLimit(PAGE_COST + COPY_COST)).toBe(1)
})
