import { describe, expect, it } from 'vitest'
import { attemptFor, planKey, rememberAfter } from './attempt'
import type { PlannedFile } from './plan'

const file = (path: string, sha256: string): PlannedFile => ({
  path,
  sha256,
  size: 1,
  bytes: new Uint8Array(1),
})
const fresh = () => 'fresh-attempt-0123456789'

describe('planKey', () => {
  it('Given the same files in another order, When keyed, Then the key is the same', () => {
    expect(planKey([file('index.html', 'a'), file('a.css', 'b')])).toBe(
      planKey([file('a.css', 'b'), file('index.html', 'a')]),
    )
  })

  it.each([
    ['another checksum', [file('index.html', 'x')]],
    ['another path', [file('other.html', 'a')]],
    ['one file more', [file('index.html', 'a'), file('a.css', 'b')]],
    ['no files', []],
  ])('Given %s, When keyed, Then the key differs', (_name, files) => {
    expect(planKey(files)).not.toBe(planKey([file('index.html', 'a')]))
  })

  it('Given a path that spells another file’s checksum and path, When keyed, Then the two plans still differ', () => {
    expect(planKey([file('b c', 'a')])).not.toBe(planKey([file('c', 'a b')]))
  })
})

describe('attemptFor', () => {
  it('Given the same content dropped again after an upload that did not finish, When an attempt is chosen, Then it is the one that upload had', () => {
    expect(attemptFor({ key: 'k', attempt: 'kept-attempt' }, 'k', fresh)).toBe(
      'kept-attempt',
    )
  })

  it.each([
    ['nothing is remembered', null],
    ['other content was remembered', { key: 'other', attempt: 'kept-attempt' }],
  ])(
    'Given %s, When an attempt is chosen, Then it is a new one',
    (_name, remembered) => {
      expect(attemptFor(remembered, 'k', fresh)).toBe(fresh())
    },
  )
})

describe('rememberAfter', () => {
  it('Given a send that failed halfway, When it is over, Then its attempt is remembered for the same content', () => {
    expect(
      rememberAfter({ ok: false, reason: 'failed', resumable: true }, 'k', 'a'),
    ).toEqual({ key: 'k', attempt: 'a' })
  })

  it.each([
    ['finished', { ok: true, manageUrl: '/slides/x', slug: 'x' } as const],
    [
      'was closed by the service',
      { ok: false, reason: 'failed', resumable: false } as const,
    ],
    [
      'was refused for a limit',
      {
        ok: false,
        reason: 'limit',
        limit: 'too_many_files',
        resumable: false,
      } as const,
    ],
    [
      'was refused as signed out',
      { ok: false, reason: 'sign_in', resumable: false } as const,
    ],
  ])(
    'Given a send that %s, When it is over, Then nothing is remembered',
    (_name, result) => {
      expect(rememberAfter(result, 'k', 'a')).toBeNull()
    },
  )
})
