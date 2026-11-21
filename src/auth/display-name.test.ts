import { expect, test } from 'vitest'
import { checkDisplayName } from './display-name'

test.each([
  ['Kobaken', 'Kobaken'],
  ['  Kobaken  ', 'Kobaken'],
  ['　山田　', '山田'],
  ['a'.repeat(50), 'a'.repeat(50)],
  ['😀'.repeat(50), '😀'.repeat(50)],
  ['あ'.repeat(50), 'あ'.repeat(50)],
])(
  'F28-AC4: Given %j, When it is checked, Then it is the name %j',
  (input, name) => {
    expect(checkDisplayName(input)).toEqual({ kind: 'valid', name })
  },
)

test.each([undefined, null, 42, '', '   ', '　　', '\t\n'])(
  'F28-AC4: Given %j, When it is checked, Then it is empty',
  (input) => {
    expect(checkDisplayName(input)).toEqual({
      kind: 'refused',
      reason: 'empty',
    })
  },
)

test.each(['a'.repeat(51), '😀'.repeat(51), 'あ'.repeat(51)])(
  'F28-AC4: Given %j characters of 51, When it is checked, Then it is too long',
  (input) => {
    expect(checkDisplayName(input)).toEqual({
      kind: 'refused',
      reason: 'too_long',
    })
  },
)
