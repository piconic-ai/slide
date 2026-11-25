import { expect, test } from 'vitest'
import { parsePage } from './pagination'

test.each([
  [undefined, 1],
  ['1', 1],
  ['2', 2],
  ['0', 1],
  ['-1', 1],
  ['1.5', 1],
  ['two', 1],
  ['', 1],
  ['9999999', 1],
])(
  'Given the page query %j, When it is parsed, Then the page is %i',
  (value, page) => {
    expect(parsePage(value)).toBe(page)
  },
)
