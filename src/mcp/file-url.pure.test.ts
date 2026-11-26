import { describe, expect, test } from 'vitest'
import {
  fileUrlKey,
  fileUrlOf,
  FILE_URL_SECONDS,
  MAX_FILE_URL_VALUE_LENGTH,
  openFileUrl,
  signFileUrl,
  type FileUrlClaims,
} from './file-url'

const SECRET = 'a-secret-that-is-long-enough-for-the-service'
const claims: FileUrlClaims = {
  grantId: '3f2b9c1e-6c1a-4f55-9a5a-0d6b8a0f1c11',
  deploymentId: '9a8b7c6d-1111-4222-8333-444455556666',
  fileId: '12',
  expiresAt: 10_000,
}
const key = await fileUrlKey(SECRET)

describe('the value of an address that opens one file', () => {
  test('F35-AC36: Given claims signed with the service’s key, When the value is opened before its time, Then the same claims come back', async () => {
    const value = await signFileUrl(key, claims)
    expect(await openFileUrl(key, value, 9_999)).toEqual({
      kind: 'ok',
      claims,
    })
  })

  test('F35-AC36: Given a value, When it is made into an address, Then it is on the service’s own origin, whatever else the value holds', () => {
    expect(fileUrlOf('https://slide.example', 'abc.def')).toBe(
      'https://slide.example/mcp/files/abc.def',
    )
    expect(FILE_URL_SECONDS).toBe(3600)
  })

  test.each([
    [9_999, 'ok'],
    [10_000, 'expired'],
    [10_001, 'expired'],
    [0, 'ok'],
  ])(
    'F35-AC37: Given a value that stops at 10000, When it is opened at %i, Then it is %s',
    async (now, kind) => {
      const value = await signFileUrl(key, claims)
      expect((await openFileUrl(key, value, now)).kind).toBe(kind)
    },
  )

  test('F35-AC39: Given a value, When any one character of it is changed, Then it opens nothing and says nothing of why', async () => {
    const value = await signFileUrl(key, claims)
    for (let i = 0; i < value.length; i++) {
      if (value[i] === '.') continue
      const other = value[i] === 'A' ? 'B' : 'A'
      const changed = `${value.slice(0, i)}${other}${value.slice(i + 1)}`
      // Even a change the decoder would read as the same bytes (spare bits
      // in the last character of a group) is a different value.
      expect(await openFileUrl(key, changed, 1)).toEqual({ kind: 'invalid' })
    }
  })

  test.each([
    ['nothing', ''],
    ['no signature', 'abc'],
    ['a trailing dot', 'abc.'],
    ['three groups', 'a.b.c'],
    ['characters outside base64url', 'a+b/c=.d+e/f='],
    ['a space', 'ab cd.ef'],
    ['a signature of the wrong length', 'abcd.abcd'],
    ['non-ASCII text', 'ああ.いい'],
  ])(
    'F35-AC39: Given %s, When it is opened, Then it is invalid',
    async (_, value) => {
      expect(await openFileUrl(key, value, 1)).toEqual({ kind: 'invalid' })
    },
  )

  test('F35-AC39: Given a value far longer than any this service makes, When it is opened, Then it is invalid without being checked', async () => {
    const value = await signFileUrl(key, claims)
    const long = `${value}${'A'.repeat(MAX_FILE_URL_VALUE_LENGTH)}`
    expect(await openFileUrl(key, long, 1)).toEqual({ kind: 'invalid' })
  })

  test('F35-AC38: Given a value signed with another secret, When it is opened with this one, Then it is invalid, and one that has run out is not told apart from it', async () => {
    const other = await fileUrlKey('another-secret-that-is-long-enough-too!!')
    const value = await signFileUrl(other, { ...claims, expiresAt: 5 })
    expect(await openFileUrl(key, value, 1)).toEqual({ kind: 'invalid' })
    expect(await openFileUrl(key, value, 99_999)).toEqual({ kind: 'invalid' })
  })

  test('F35-AC38: Given the same claims, When the key is made again from the same secret, Then values made before still open, and each claim is bound: changing one asks for a new signature', async () => {
    const value = await signFileUrl(key, claims)
    expect((await openFileUrl(await fileUrlKey(SECRET), value, 1)).kind).toBe(
      'ok',
    )
    for (const changed of [
      { ...claims, grantId: 'other-grant' },
      { ...claims, deploymentId: 'other-deployment' },
      { ...claims, fileId: '13' },
      { ...claims, expiresAt: claims.expiresAt + 1 },
    ])
      expect(await signFileUrl(key, changed)).not.toBe(value)
  })

  test.each([
    ['a slash in an ID', { ...claims, fileId: '../x' }],
    ['an empty ID', { ...claims, grantId: '' }],
    ['a very long ID', { ...claims, deploymentId: 'a'.repeat(65) }],
    ['a fraction as the time', { ...claims, expiresAt: 1.5 }],
    ['a negative time', { ...claims, expiresAt: -1 }],
  ])(
    'F35-AC39: Given a signed value whose claims are %s, When it is opened, Then it is invalid',
    async (_, odd) => {
      expect(await openFileUrl(key, await signFileUrl(key, odd), 0)).toEqual({
        kind: 'invalid',
      })
    },
  )

  test('F35-AC39: Given a signature over something that is not the claims, When it is opened, Then it is invalid', async () => {
    const payload = btoa('["v2","a","b","c",9]').replaceAll('=', '')
    const mac = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)),
    )
    const signature = btoa(String.fromCharCode(...mac))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')
    expect(await openFileUrl(key, `${payload}.${signature}`, 0)).toEqual({
      kind: 'invalid',
    })
  })
})
