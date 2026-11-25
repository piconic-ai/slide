import { expect, test } from 'vitest'
import { ownerSessionSql, signOwnerCookie } from './owner-cookie.mjs'

const token = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
const person = {
  userId: '722500',
  email: 'kfly8@local.example',
  name: 'kfly8',
}

test.each([
  ['a user id with a quote', { userId: "1' OR '1'='1" }],
  ['an empty user id', { userId: '' }],
  ['an address with a quote', { email: "a'b@local.example" }],
  ['text that is not an address', { email: 'nobody' }],
  ['a token with a quote', { token: "abcdefghijklmnop'" }],
  ['a short token', { token: 'short' }],
  ['a time that is not a number', { now: '2026-11-20' }],
])('Given %s, When the SQL is made, Then it throws', (_, change) => {
  expect(() =>
    ownerSessionSql({ ...person, token, now: 1, ...change }),
  ).toThrow()
})

test.each([undefined, '', 'too-short'])(
  'Given the secret %j, When a cookie is signed, Then it throws',
  (secret) => {
    expect(() => signOwnerCookie(token, secret)).toThrow()
  },
)
