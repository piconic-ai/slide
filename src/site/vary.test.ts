import { expect, test } from 'vitest'
import { withVary } from './vary'

const names = ['Accept-Language', 'Cookie']

test.each([
  [null, 'Accept-Language, Cookie'],
  ['', 'Accept-Language, Cookie'],
  ['Accept-Encoding', 'Accept-Encoding, Accept-Language, Cookie'],
  ['cookie', 'cookie, Accept-Language'],
  ['Accept-Language, Cookie', 'Accept-Language, Cookie'],
  [' Origin ,, ', 'Origin, Accept-Language, Cookie'],
  ['*', '*'],
])(
  'Given Vary %j, When language headers are added, Then it reads %j',
  (vary, expected) => {
    expect(withVary(vary, names)).toBe(expected)
  },
)
