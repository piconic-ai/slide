import { describe, expect, it } from 'vitest'
import { freshStash, STASH_MAX_AGE_MS, STASH_SIGN_IN_PATH } from './stash'

const now = 1_800_000_000_000
const file = (name = 'talk.html', size = 12) => ({
  name,
  size,
  arrayBuffer: async () => new ArrayBuffer(size),
})
const record = (change: Record<string, unknown> = {}) => ({
  file: file(),
  attempt: '2f1c7d2e-8a53-4a0b-9a57-0d1f4c0f6b11',
  storedAt: now - 1000,
  ...change,
})

describe('freshStash', () => {
  it('F22-AC10: Given a file kept a moment ago, When read, Then it is given back with its attempt', () => {
    const kept = record()

    expect(freshStash(kept, now)).toEqual({
      file: kept.file,
      attempt: kept.attempt,
      storedAt: kept.storedAt,
    })
  })

  it('Given a file kept one millisecond short of 24 hours ago, When read, Then it is still used', () => {
    expect(
      freshStash(record({ storedAt: now - STASH_MAX_AGE_MS + 1 }), now),
    ).not.toBeNull()
  })

  it.each([
    ['exactly 24 hours ago', now - STASH_MAX_AGE_MS],
    ['two days ago', now - 2 * STASH_MAX_AGE_MS],
    ['in the future', now + 1],
  ])(
    'F22-AC11: Given a file kept %s, When read, Then it is treated as not there',
    (_name, storedAt) => {
      expect(freshStash(record({ storedAt }), now)).toBeNull()
    },
  )

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['text', 'talk.html'],
    ['a list', [record()]],
    ['an empty object', {}],
    ['a record without a file', record({ file: undefined })],
    ['a file that is only its name', record({ file: 'talk.html' })],
    [
      'a file that cannot be read',
      record({ file: { name: 'a.html', size: 1 } }),
    ],
    [
      'a file without a size',
      record({ file: { ...file(), size: Number.NaN } }),
    ],
    ['no attempt', record({ attempt: undefined })],
    ['a short attempt', record({ attempt: 'short' })],
    [
      'an attempt with other characters',
      record({ attempt: 'a'.repeat(16) + '/../x' }),
    ],
    ['a time that is text', record({ storedAt: String(now) })],
    ['a time that is not a number', record({ storedAt: Number.NaN })],
    ['an endless time', record({ storedAt: -Infinity })],
  ])(
    'F22-AC11: Given %s in storage, When read, Then it is treated as not there',
    (_name, stored) => {
      expect(freshStash(stored, now)).toBeNull()
    },
  )
})

it('F22-AC10: Given the way to sign in from a kept file, When read, Then it asks sign-in to come back to the top page', () => {
  expect(STASH_SIGN_IN_PATH).toBe('/auth/github?to=top')
})
