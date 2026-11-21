import { describe, expect, it } from 'vitest'
import {
  continueMark,
  freshStash,
  isContinuing,
  STASH_CONTINUE_MAX_AGE_MS,
  STASH_MAX_AGE_MS,
  STASH_SIGN_IN_PATH,
  stashLanding,
  stashSignInPath,
} from './stash'

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
  expect(STASH_SIGN_IN_PATH).toBe('/login?to=top')
})

describe('isContinuing', () => {
  const kept = { attempt: '2f1c7d2e-8a53-4a0b-9a57-0d1f4c0f6b11' }
  const token = '9d0b6a51-7c1e-4f55-8a43-5e2f1b7c9a10'
  const pressed = now - 60_000
  const mark = continueMark(kept.attempt, token, pressed)

  it('F22-AC10: Given the mark the button left for this kept file, When the visitor comes back from that sign-in a minute later, Then the file is theirs to receive', () => {
    expect(isContinuing(mark, kept, token, now)).toBe(true)
  })

  it('Given the mark was left one millisecond short of ten minutes ago, When the visitor comes back, Then the file is still received', () => {
    expect(
      isContinuing(mark, kept, token, pressed + STASH_CONTINUE_MAX_AGE_MS - 1),
    ).toBe(true)
  })

  it.each([
    ['exactly ten minutes', pressed + STASH_CONTINUE_MAX_AGE_MS],
    ['a day', pressed + STASH_MAX_AGE_MS],
    ['a time before the press, the clock set back', pressed - 1],
  ])(
    'F22-AC11: Given "continue" was pressed and the top page opens after %s, When checked, Then the kept file is not received by itself',
    (_name, at) => {
      expect(isContinuing(mark, kept, token, at)).toBe(false)
    },
  )

  it.each([
    ['no token, as when someone signed in from the header', null],
    ['no token at all', undefined],
    ['an empty token', ''],
    ['the token of another press', '11111111-2222-3333-4444-555555555555'],
    ['a token that only starts the same', token.slice(0, 20)],
  ])(
    'F22-AC11: Given the mark of an abandoned sign-in and a page reached with %s, When a signed-in visitor opens the top page, Then the kept file is not received by itself',
    (_name, returned) => {
      expect(isContinuing(mark, kept, returned, now)).toBe(false)
    },
  )

  it.each([
    ['no mark, as when someone signed in from the header', null],
    ['no mark at all', undefined],
    ['an empty mark', ''],
    ['a mark of the older shape, the attempt alone', kept.attempt],
    ['a mark that is not an object', '"text"'],
    ['a mark that is null', 'null'],
    [
      'the mark of another kept file',
      continueMark('11111111-2222-3333-4444-555555555555', token, pressed),
    ],
    ['a mark without a time', JSON.stringify({ attempt: kept.attempt, token })],
    [
      'a mark whose time is text',
      JSON.stringify({ attempt: kept.attempt, token, at: String(pressed) }),
    ],
    [
      'a mark whose token is not one',
      JSON.stringify({ attempt: kept.attempt, token: 'x', at: pressed }),
    ],
  ])(
    'F22-AC11: Given %s, When a signed-in visitor opens the top page, Then the kept file is not received by itself',
    (_name, left) => {
      // The page is reached with whatever token the mark names, if any.
      const returned = left?.includes('"token":"x"') ? 'x' : token
      expect(isContinuing(left, kept, returned, now)).toBe(false)
    },
  )

  it('Given a mark but nothing kept, When checked, Then there is nothing to receive', () => {
    expect(isContinuing(mark, null, token, now)).toBe(false)
  })
})

describe('the way to sign in for a kept file', () => {
  const token = '9d0b6a51-7c1e-4f55-8a43-5e2f1b7c9a10'

  it('F22-AC10: Given a token, When the way to sign in is made, Then it asks to come back to the top page with that token', () => {
    expect(stashSignInPath(token)).toBe(`/login?to=top&drop=${token}`)
  })

  it('F22-AC10: Given the token a sign-in carried, When it lands, Then the top page is reached with that token', () => {
    expect(stashLanding(token)).toBe(`/?drop=${token}`)
  })

  it.each([
    ['nothing', undefined],
    ['an empty value', ''],
    ['a short value', 'short'],
    ['a value that would add a query', `${'a'.repeat(16)}&to=//evil.example`],
    ['a value with a path', `${'a'.repeat(16)}/../x`],
    ['a value that is too long', 'a'.repeat(65)],
    ['a value that is not text', 12],
  ])(
    'Given %s as the token, When a sign-in lands, Then it is the plain top page',
    (_name, value) => {
      expect(stashLanding(value)).toBe('/')
    },
  )
})
