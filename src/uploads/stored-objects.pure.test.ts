import { describe, expect, test } from 'vitest'
import { checkStoredObject, hexDigest } from './stored-objects'

const expected = { size: 1, sha256: 'ab'.repeat(32) }

describe('stored object check', () => {
  test.each([
    [{ size: 1, sha256: 'ab'.repeat(32) }, 'ok'],
    [null, 'missing'],
    [{ size: 2, sha256: 'ab'.repeat(32) }, 'mismatch'],
    [{ size: 1, sha256: 'cd'.repeat(32) }, 'mismatch'],
    [{ size: 1, sha256: null }, 'mismatch'],
  ] as const)('given %j, returns %s', (stored, check) => {
    expect(checkStoredObject(expected, stored)).toBe(check)
  })

  test('encodes checksums as lowercase hex', () => {
    expect(hexDigest(new Uint8Array([0, 15, 255]).buffer)).toBe('000fff')
    expect(hexDigest(undefined)).toBeNull()
  })
})
