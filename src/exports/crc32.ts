// A CRC-32 that can be fed in pieces, as a zip stores one per file and the
// bytes of a file arrive as a stream. Pure: bytes in, number out.

// Slicing-by-4: four tables let the loop take a word at a time, about three
// times faster than one byte at a time, which matters when a Worker pays for
// every byte in CPU time.
const TABLES = (() => {
  const tables = Array.from({ length: 4 }, () => new Uint32Array(256))
  const first = tables[0]!
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    first[index] = value >>> 0
  }
  for (let index = 0; index < 256; index++)
    for (let slice = 1; slice < 4; slice++) {
      const previous = tables[slice - 1]![index]!
      tables[slice]![index] = (first[previous & 0xff]! ^ (previous >>> 8)) >>> 0
    }
  return tables as [Uint32Array, Uint32Array, Uint32Array, Uint32Array]
})()

/** The state of a CRC-32 before any byte; pass it to `crc32Update`. */
export const CRC32_START = 0xffffffff

/** The state after `bytes` follow the bytes that led to `state`. */
export function crc32Update(state: number, bytes: Uint8Array): number {
  const [t0, t1, t2, t3] = TABLES
  let crc = state
  let at = 0
  const end4 = bytes.length - (bytes.length % 4)
  for (; at < end4; at += 4) {
    crc ^=
      bytes[at]! |
      (bytes[at + 1]! << 8) |
      (bytes[at + 2]! << 16) |
      (bytes[at + 3]! << 24)
    crc =
      t3[crc & 0xff]! ^
      t2[(crc >>> 8) & 0xff]! ^
      t1[(crc >>> 16) & 0xff]! ^
      t0[crc >>> 24]!
  }
  for (; at < bytes.length; at++)
    crc = t0[(crc ^ bytes[at]!) & 0xff]! ^ (crc >>> 8)
  return crc >>> 0
}

/** The CRC-32 a zip stores, from the state after all the bytes. */
export const crc32Finish = (state: number): number => (state ^ 0xffffffff) >>> 0
