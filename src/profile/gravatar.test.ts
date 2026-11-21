import { describe, expect, test } from 'vitest'
import {
  GRAVATAR_KEEP_SECONDS,
  gravatarHash,
  gravatarUrl,
  isFresh,
} from './gravatar'

describe('F28-AC48: the hash Gravatar knows an address by', () => {
  test('Given the address from Gravatar’s documentation, When it is hashed, Then the result is the documented SHA-256', async () => {
    expect(await gravatarHash('MyEmailAddress@example.com ')).toBe(
      '84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee',
    )
  })
  test.each([' a@b.example ', 'A@B.EXAMPLE', '\ta@b.example\n'])(
    'Given %j, When it is hashed, Then white space and case do not change the hash',
    async (email) => {
      expect(await gravatarHash(email)).toBe(await gravatarHash('a@b.example'))
    },
  )
  test('Given two different addresses, including a plus-tagged one, When they are hashed, Then the hashes differ', async () => {
    expect(await gravatarHash('a@b.example')).not.toBe(
      await gravatarHash('a+tag@b.example'),
    )
  })
  test('Given a hash, When the address is built, Then it asks Gravatar for a 256 pixel picture and a 404 where there is none', () => {
    expect(gravatarUrl('abc')).toBe(
      'https://gravatar.com/avatar/abc?s=256&d=404',
    )
  })
})

describe('F28-AC50: how long an answer is kept', () => {
  test.each([
    ['image', GRAVATAR_KEEP_SECONDS.image - 1, true],
    ['image', GRAVATAR_KEEP_SECONDS.image, false],
    ['none', GRAVATAR_KEEP_SECONDS.none - 1, true],
    ['none', GRAVATAR_KEEP_SECONDS.none, false],
    ['none', 0, true],
    ['none', -1, false],
  ] as const)(
    'Given a kept %s that is %i seconds old, When it is checked, Then it is fresh: %s',
    (kind, age, fresh) => {
      expect(isFresh({ kind, at: 1000 }, 1000 + age)).toBe(fresh)
    },
  )
})
