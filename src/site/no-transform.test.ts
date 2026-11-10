import { expect, test } from 'vitest'
import { isHtml, withNoTransform } from './no-transform'

test.each([
  [null, 'no-transform'],
  ['', 'no-transform'],
  ['no-store', 'no-store, no-transform'],
  ['private, max-age=0', 'private, max-age=0, no-transform'],
  ['no-cache, no-transform', 'no-cache, no-transform'],
  ['NO-TRANSFORM', 'NO-TRANSFORM'],
  [' no-store ,, max-age=60 ', 'no-store, max-age=60, no-transform'],
])(
  'Given Cache-Control %j, When no-transform is added, Then it reads %j',
  (value, expected) => {
    expect(withNoTransform(value)).toBe(expected)
  },
)

test.each([
  ['text/html; charset=utf-8', true],
  ['TEXT/HTML', true],
  ['application/json', false],
  ['text/plain; charset=utf-8', false],
  ['text/htmlx', false],
  ['text/html-foo', false],
  ['text/html ;charset=utf-8', true],
  [null, false],
])('Given Content-Type %j, Then it is HTML: %s', (value, expected) => {
  expect(isHtml(value)).toBe(expected)
})
