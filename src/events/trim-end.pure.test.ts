import { expect, test } from 'vitest'
import { trimEnd } from './trim-end'

test.each([
  ['https://lu.ma/x...', '.,;:!?', 'https://lu.ma/x'],
  ['https://lu.ma/x.,;:!?', '.,;:!?', 'https://lu.ma/x'],
  ['a.b', '.', 'a.b'],
  ['/event/1///', '/', '/event/1'],
  ['///', '/', ''],
  ['', '/', ''],
  ['abc', '', 'abc'],
  ['x😀/', '/', 'x😀'],
])(
  'Given %o, When %o is trimmed off its end, Then it is %o',
  (text, chars, expected) => {
    expect(trimEnd(text, chars)).toBe(expected)
  },
)
