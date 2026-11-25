import { describe, expect, test } from 'vitest'
import { PICTURE_PNG_MAX_BYTES } from './picture-policy'
import { cleanPicturePng, PNG_MAX_CHUNKS } from './picture-png'
import {
  chunkTypes,
  pngChunk,
  pngHeader,
  pngOf,
  pngPixels,
} from './test-picture'

const HEADER = pngChunk('IHDR', pngHeader(256, 256))
const DATA = pngChunk('IDAT', pngPixels(256, 256))
const END = pngChunk('IEND')

describe('F28-AC97: the time to check grows with the size and no faster', () => {
  /** A 256 by 256 PNG of about `bytes`, its image data in 1 KB chunks. */
  const sized = (bytes: number) => {
    const pieces: Uint8Array[] = []
    let size = 8 + HEADER.length + END.length
    while (size + 1036 <= bytes) {
      pieces.push(pngChunk('IDAT', new Uint8Array(1024)))
      size += 1036
    }
    return pngOf(HEADER, ...pieces, END)
  }
  /** The median time of one check, each sample taken over `runs` checks. */
  const timeOf = (bytes: Uint8Array, runs: number) => {
    const samples: number[] = []
    for (let i = 0; i < 7; i++) {
      const start = performance.now()
      for (let run = 0; run < runs; run++) cleanPicturePng(bytes)
      samples.push((performance.now() - start) / runs)
    }
    return samples.sort((a, b) => a - b)[3]!
  }

  test('Given PNGs of 32 KB and of 16 times that, When each is checked, Then the larger one takes far less than the square of the ratio', () => {
    const small = sized(32 * 1024)
    const large = sized(PICTURE_PNG_MAX_BYTES - 1024)
    expect(chunkTypes(large).length).toBeLessThan(PNG_MAX_CHUNKS)
    expect(cleanPicturePng(small).kind).toBe('ok')
    expect(cleanPicturePng(large).kind).toBe('ok')
    // Warm up, so the first run's compilation is not counted.
    timeOf(large, 4)
    timeOf(small, 64)
    const ratio = timeOf(large, 4) / Math.max(timeOf(small, 64), 0.001)
    // Linear work is about 16 times; work that grew with the square, 256.
    expect(ratio).toBeLessThan(64)
  })

  test('Given the largest PNG of the smallest chunks, When it is checked, Then it is answered at once', () => {
    const many = Array.from({ length: PNG_MAX_CHUNKS - 3 }, () =>
      pngChunk('tEXt', new Uint8Array(400)),
    )
    const bytes = pngOf(HEADER, ...many, DATA, END)
    expect(bytes.length).toBeLessThanOrEqual(PICTURE_PNG_MAX_BYTES)
    const start = performance.now()
    expect(cleanPicturePng(bytes).kind).toBe('ok')
    expect(performance.now() - start).toBeLessThan(500)
  })
})
