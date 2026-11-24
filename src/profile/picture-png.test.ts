import { describe, expect, test } from 'vitest'
import { PICTURE_PNG_MAX_BYTES } from './picture-policy'
import { cleanPicturePng, crc32, PNG_MAX_CHUNKS } from './picture-png'
import {
  chunkTypes,
  pngChunk,
  pngHeader,
  pngOf,
  pngPixels,
  squarePng,
} from './test-picture'

const ascii = (text: string) => new TextEncoder().encode(text)
const HEADER = pngChunk('IHDR', pngHeader(256, 256))
const DATA = pngChunk('IDAT', pngPixels(256, 256))
const END = pngChunk('IEND')

const refusalOf = (bytes: Uint8Array) => {
  const result = cleanPicturePng(bytes)
  return result.kind === 'refused' ? result.reason : 'ok'
}
const keptTypes = (bytes: Uint8Array) => {
  const result = cleanPicturePng(bytes)
  if (result.kind !== 'ok') throw new Error(`refused: ${result.reason}`)
  return chunkTypes(result.bytes)
}

describe('crc32', () => {
  test('Given the bytes of IEND, When the CRC is taken, Then it is the value every PNG ends with', () => {
    expect(crc32(ascii('IEND'))).toBe(0xae426082)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('F28-AC97: only a whole 256 by 256 PNG is kept', () => {
  test('Given the PNG a browser would send, When it is checked, Then it is kept byte for byte', () => {
    const picture = squarePng()
    const result = cleanPicturePng(picture)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok')
      expect(Buffer.from(result.bytes).equals(Buffer.from(picture))).toBe(true)
  })

  test.each([
    [1, 256],
    [256, 255],
    [257, 256],
    [300, 200],
    [512, 512],
    [0, 0],
  ])(
    'Given a %d by %d PNG, When it is checked, Then it is refused for its size',
    (width, height) => {
      const bytes = pngOf(pngChunk('IHDR', pngHeader(width, height)), DATA, END)
      expect(refusalOf(bytes)).toBe('wrong_size')
    },
  )

  test.each([
    ['HTML', ascii('<!doctype html><script>alert(1)</script>')],
    ['SVG', ascii('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')],
    ['a JPEG', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])],
    ['a WebP', ascii('RIFF\x10\x00\x00\x00WEBPVP8 ')],
    ['a GIF', ascii('GIF89a\x00\x01\x00\x01')],
    ['nothing', new Uint8Array(0)],
    ['the signature cut short', pngOf().subarray(0, 7)],
    [
      'a signature with one byte changed',
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b]),
    ],
    [
      'HTML that ends in a PNG',
      Uint8Array.from([...ascii('<html>'), ...squarePng()]),
    ],
  ])(
    'Given %s, When it is checked, Then it is refused as not a PNG',
    (_, bytes) => {
      expect(refusalOf(bytes)).toBe('not_png')
    },
  )

  test('Given only the signature, When it is checked, Then it is refused for having no end', () => {
    expect(refusalOf(pngOf())).toBe('no_end')
  })

  test('Given a PNG of exactly the largest size, When it is checked, Then the size alone does not refuse it', () => {
    const filler = PICTURE_PNG_MAX_BYTES - squarePng().length - 12
    const bytes = pngOf(
      HEADER,
      pngChunk('zzZz', new Uint8Array(filler)),
      DATA,
      END,
    )
    expect(bytes.length).toBe(PICTURE_PNG_MAX_BYTES)
    expect(keptTypes(bytes)).toEqual(['IHDR', 'IDAT', 'IEND'])
  })

  test('Given a PNG one byte over the largest size, When it is checked, Then it is refused as too large', () => {
    const filler = PICTURE_PNG_MAX_BYTES - squarePng().length - 11
    const bytes = pngOf(
      HEADER,
      pngChunk('zzZz', new Uint8Array(filler)),
      DATA,
      END,
    )
    expect(refusalOf(bytes)).toBe('too_large')
  })
})

describe('F28-AC97: a PNG whose chunks are broken is refused', () => {
  test('Given a chunk whose CRC does not match, When it is checked, Then it is refused', () => {
    const bytes = squarePng()
    bytes[bytes.length - 20] ^= 0xff
    expect(refusalOf(bytes)).toBe('bad_crc')
  })

  test('Given a header whose CRC was not updated after its width changed, When it is checked, Then it is refused', () => {
    const bytes = squarePng()
    bytes[8 + 8 + 3] = 0x01
    expect(refusalOf(bytes)).toBe('bad_crc')
  })

  test.each([
    ['a length longer than what is left', 0x00010000],
    ['a length near 2^32', 0xffffffff],
    ['the largest signed length', 0x7fffffff],
  ])(
    'Given %s, When it is checked, Then it is refused as cut short, without reading past the end',
    (_, length) => {
      const bytes = squarePng()
      new DataView(bytes.buffer).setUint32(8 + HEADER.length, length)
      expect(refusalOf(bytes)).toBe('truncated')
    },
  )

  test('Given a PNG cut in the middle of a chunk, When it is checked, Then it is refused as cut short', () => {
    const whole = squarePng()
    for (const end of [9, 20, 40, whole.length - 1])
      expect(refusalOf(whole.subarray(0, end))).toBe('truncated')
  })

  test('Given a PNG with no IEND, When it is checked, Then it is refused', () => {
    expect(refusalOf(pngOf(HEADER, DATA))).toBe('no_end')
  })

  test.each([
    ['HTML', ascii('<script>alert(1)</script>')],
    ['one byte', Uint8Array.from([0])],
    ['another PNG', squarePng()],
  ])(
    'Given %s after IEND, When it is checked, Then it is refused',
    (_, tail) => {
      expect(refusalOf(pngOf(HEADER, DATA, END, tail))).toBe('trailing_bytes')
    },
  )

  test.each([
    ['digits', '1234'],
    ['a space', 'ID T'],
    ['a byte over ASCII', 'IDéT'],
  ])(
    'Given a chunk type with %s, When it is checked, Then it is refused',
    (_, type) => {
      expect(refusalOf(pngOf(HEADER, pngChunk(type), DATA, END))).toBe(
        'bad_chunk_type',
      )
    },
  )

  test('Given more chunks than any browser writes, When it is checked, Then it is refused', () => {
    const many = Array.from({ length: PNG_MAX_CHUNKS }, () => pngChunk('tEXt'))
    expect(refusalOf(pngOf(HEADER, ...many, DATA, END))).toBe('too_many_chunks')
    const fewer = many.slice(0, PNG_MAX_CHUNKS - 3)
    expect(keptTypes(pngOf(HEADER, ...fewer, DATA, END))).toEqual([
      'IHDR',
      'IDAT',
      'IEND',
    ])
  })
})

describe('F28-AC97: the header and the order of the chunks are those a decoder knows', () => {
  test.each([
    ['IDAT first', pngOf(DATA, HEADER, END)],
    [
      'a header 12 bytes long',
      pngOf(pngChunk('IHDR', new Uint8Array(12)), DATA, END),
    ],
    ['only IEND', pngOf(END)],
  ])('Given %s, When it is checked, Then the header is refused', (_, bytes) => {
    expect(refusalOf(bytes)).toBe('bad_header')
  })

  test.each([
    ['depth 3', { depth: 3 }],
    ['colour type 5', { colorType: 5 }],
    ['RGB of depth 4', { colorType: 2, depth: 4 }],
    ['interlace 2', { interlace: 2 }],
  ])(
    'Given a header with %s, When it is checked, Then it is refused',
    (_, fields) => {
      const bytes = pngOf(
        pngChunk('IHDR', pngHeader(256, 256, fields)),
        DATA,
        END,
      )
      expect(refusalOf(bytes)).toBe('bad_header')
    },
  )

  test('Given a header with compression or filter methods other than 0, When it is checked, Then it is refused', () => {
    for (const at of [10, 11]) {
      const header = pngHeader(256, 256)
      header[at] = 1
      expect(refusalOf(pngOf(pngChunk('IHDR', header), DATA, END))).toBe(
        'bad_header',
      )
    }
  })

  test.each([
    ['no image data', pngOf(HEADER, END)],
    ['two headers', pngOf(HEADER, HEADER, DATA, END)],
    [
      'image data split by another chunk',
      pngOf(HEADER, DATA, pngChunk('tEXt'), DATA, END),
    ],
    [
      'a palette after the image data',
      pngOf(HEADER, DATA, pngChunk('PLTE', new Uint8Array(3)), END),
    ],
    [
      'two palettes',
      pngOf(
        HEADER,
        pngChunk('PLTE', new Uint8Array(3)),
        pngChunk('PLTE', new Uint8Array(3)),
        DATA,
        END,
      ),
    ],
    [
      'a palette picture with no palette',
      pngOf(pngChunk('IHDR', pngHeader(256, 256, { colorType: 3 })), DATA, END),
    ],
    [
      'a grey picture with a palette',
      pngOf(
        pngChunk('IHDR', pngHeader(256, 256, { colorType: 0 })),
        pngChunk('PLTE', new Uint8Array(3)),
        DATA,
        END,
      ),
    ],
  ])('Given %s, When it is checked, Then it is refused', (_, bytes) => {
    expect(refusalOf(bytes)).toBe('bad_order')
  })

  test('Given a critical chunk no decoder knows, When it is checked, Then it is refused', () => {
    expect(refusalOf(pngOf(HEADER, pngChunk('ABCD'), DATA, END))).toBe(
      'unknown_critical',
    )
  })

  test('Given a palette picture with its palette, When it is checked, Then it is kept', () => {
    const bytes = pngOf(
      pngChunk('IHDR', pngHeader(256, 256, { colorType: 3 })),
      pngChunk('PLTE', new Uint8Array(6)),
      pngChunk('tRNS', new Uint8Array(2)),
      DATA,
      END,
    )
    expect(keptTypes(bytes)).toEqual(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])
  })
})

describe('F28-AC98: only the chunks a picture is shown with are kept', () => {
  const EXIF = pngChunk('eXIf', ascii('MM\x00*GPS 35.6895 139.6917'))
  const TEXT = pngChunk('tEXt', ascii('Comment\x00secret place'))

  test('Given text, EXIF, a time and print sizes, When the PNG is cleaned, Then none of them is kept, and the secret is not in the bytes', () => {
    const bytes = pngOf(
      HEADER,
      TEXT,
      pngChunk('zTXt', ascii('Author\x00\x00xx')),
      pngChunk('iTXt', ascii('Title\x00\x00\x00\x00\x00secret')),
      EXIF,
      pngChunk('tIME', new Uint8Array(7)),
      pngChunk('pHYs', new Uint8Array(9)),
      pngChunk('bKGD', new Uint8Array(6)),
      DATA,
      pngChunk('tEXt', ascii('After\x00secret too')),
      END,
    )
    const result = cleanPicturePng(bytes)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(chunkTypes(result.bytes)).toEqual(['IHDR', 'IDAT', 'IEND'])
    const text = Buffer.from(result.bytes).toString('latin1')
    expect(text).not.toContain('secret')
    expect(text).not.toContain('GPS')
    // What is kept is itself a picture the service keeps.
    expect(cleanPicturePng(result.bytes).kind).toBe('ok')
  })

  test('Given the colour chunks before the image data, When the PNG is cleaned, Then they are kept in their order', () => {
    const bytes = pngOf(
      HEADER,
      pngChunk('iCCP', ascii('Display P3\x00\x00profile')),
      pngChunk('sRGB', Uint8Array.from([0])),
      pngChunk('gAMA', new Uint8Array(4)),
      pngChunk('cHRM', new Uint8Array(32)),
      TEXT,
      DATA,
      END,
    )
    expect(keptTypes(bytes)).toEqual([
      'IHDR',
      'iCCP',
      'sRGB',
      'gAMA',
      'cHRM',
      'IDAT',
      'IEND',
    ])
  })

  test('Given a colour chunk after the image data, where it means nothing, When the PNG is cleaned, Then it is left out', () => {
    const bytes = pngOf(
      HEADER,
      DATA,
      pngChunk('sRGB', Uint8Array.from([0])),
      END,
    )
    expect(keptTypes(bytes)).toEqual(['IHDR', 'IDAT', 'IEND'])
  })

  test('Given an animated PNG (acTL, fcTL, fdAT), When it is cleaned, Then only its still picture is kept', () => {
    const bytes = pngOf(
      HEADER,
      pngChunk('acTL', new Uint8Array(8)),
      pngChunk('fcTL', new Uint8Array(26)),
      DATA,
      pngChunk('fcTL', new Uint8Array(26)),
      pngChunk('fdAT', new Uint8Array(40)),
      END,
    )
    expect(keptTypes(bytes)).toEqual(['IHDR', 'IDAT', 'IEND'])
  })

  test('Given HTML hidden in a text chunk, When the PNG is cleaned, Then the HTML is not in what is kept', () => {
    const bytes = pngOf(
      HEADER,
      pngChunk('tEXt', ascii('x\x00<html><script>alert(1)</script>')),
      DATA,
      END,
    )
    const result = cleanPicturePng(bytes)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok')
      expect(Buffer.from(result.bytes).toString('latin1')).not.toContain(
        '<script>',
      )
  })

  test('Given image data in several chunks, When the PNG is cleaned, Then every one is kept in order', () => {
    const pixels = pngPixels(256, 256)
    const half = Math.floor(pixels.length / 2)
    const bytes = pngOf(
      HEADER,
      pngChunk('IDAT', pixels.subarray(0, half)),
      pngChunk('IDAT', pixels.subarray(half)),
      END,
    )
    expect(keptTypes(bytes)).toEqual(['IHDR', 'IDAT', 'IDAT', 'IEND'])
  })
})

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
