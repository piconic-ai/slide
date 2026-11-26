import { expect, test } from 'vitest'
import { isBackedUp } from './keys'

test.each([
  ['a slide file', '9a093341-8da7-45ac-89be-db566fecb5a4/0/lease'],
  ['an uploaded picture', 'avatars/user-1'],
  ['a community picture', 'communities/12/logo'],
  ['a key of a prefix that does not exist yet', 'something-new/1'],
])('F39-AC25: Given %s, When asked, Then it is backed up', (_, key) => {
  expect(isBackedUp(key)).toBe(true)
})

test.each([
  ['the cache of a Gravatar', 'gravatar/user-1'],
  ['an export lock', 'exports/leases/user-1'],
])('F39-AC25: Given %s, When asked, Then it is left out', (_, key) => {
  expect(isBackedUp(key)).toBe(false)
})

test('F39-AC25: Given keys that only resemble a left-out prefix, When asked, Then they are backed up', () => {
  // The prefix ends at a slash: `gravatars/x` and `exports-old/x` are other keys.
  expect(isBackedUp('gravatars/x')).toBe(true)
  expect(isBackedUp('exports-old/x')).toBe(true)
  expect(isBackedUp('Gravatar/x')).toBe(true)
  expect(isBackedUp('')).toBe(true)
})
