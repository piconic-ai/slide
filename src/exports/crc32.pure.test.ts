import { describe, expect, it } from 'vitest'
import { crc32 } from '../drops/zip'
import { CRC32_START, crc32Finish, crc32Update } from './crc32'

const crcOf = (bytes: Uint8Array) =>
  crc32Finish(crc32Update(CRC32_START, bytes))

describe('crc32Update', () => {
  it('Given the check string 123456789, When checksummed, Then it is the standard CRC-32 value', () => {
    expect(crcOf(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('Given no bytes, When checksummed, Then it is zero', () => {
    expect(crcOf(new Uint8Array())).toBe(0)
  })

  it.each([1, 2, 3, 4, 5, 7, 8, 9, 63, 64, 65, 1000, 4097])(
    'Given %i random bytes, When checksummed, Then it equals the reader of zips computes',
    (length) => {
      const bytes = new Uint8Array(length)
      for (let index = 0; index < length; index++)
        bytes[index] = (index * 131 + 7) % 256
      expect(crcOf(bytes)).toBe(crc32(bytes))
    },
  )

  it('Given bytes fed in pieces cut anywhere, When checksummed, Then the result does not depend on the cuts', () => {
    const bytes = new Uint8Array(1000).map((_, index) => (index * 17) % 256)
    for (const cut of [1, 3, 4, 5, 333, 999]) {
      const state = crc32Update(
        crc32Update(CRC32_START, bytes.subarray(0, cut)),
        bytes.subarray(cut),
      )
      expect(crc32Finish(state)).toBe(crc32(bytes))
    }
  })

  it('Given bytes with the high bit set, When checksummed, Then the result is an unsigned number', () => {
    const bytes = new Uint8Array(16).fill(0xff)
    expect(crcOf(bytes)).toBeGreaterThanOrEqual(0)
    expect(crcOf(bytes)).toBe(crc32(bytes))
  })
})
