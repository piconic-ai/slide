import { expect, test } from 'vitest'
import { normalizeAddress } from './address'

test.each([
  ['a@example.com', 'a@example.com'],
  ['  A@Example.COM  ', 'a@example.com'],
  ['a+tag@example.com', 'a+tag@example.com'],
])('F28-AC24: Given %j, When it is normalized, Then it is %j', (input, out) => {
  expect(normalizeAddress(input)).toBe(out)
})

test.each([
  '',
  '   ',
  'plain',
  'a@',
  '@b.example',
  'a b@example.com',
  `${'a'.repeat(250)}@example.com`,
  undefined,
  null,
  42,
])(
  'F28-AC24: Given %j, When it is normalized, Then it is not an address',
  (input) => {
    expect(normalizeAddress(input)).toBeNull()
  },
)
