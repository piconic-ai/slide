import { describe, expect, test } from 'vitest'
import {
  checkPictureFile,
  PICTURE_MAX_BYTES,
  pictureFormatOf,
  withinPictureSides,
} from './picture-policy'

const bytes = (...values: number[]) => new Uint8Array(values)
const ascii = (text: string) => new TextEncoder().encode(text)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46)
const WEBP = bytes(
  ...ascii('RIFF'),
  1,
  2,
  3,
  4,
  ...ascii('WEBP'),
  ...ascii('VP8 '),
)

describe('F28-AC42: only PNG, JPEG and WebP are pictures, whatever the file is called', () => {
  test.each([
    ['PNG', PNG, 'png'],
    ['JPEG', JPEG, 'jpeg'],
    ['WebP', WEBP, 'webp'],
  ] as const)(
    'Given a %s, When its first bytes are read, Then it is %s',
    (_, head, format) => {
      expect(pictureFormatOf(head)).toBe(format)
      expect(checkPictureFile(1000, head)).toEqual({ kind: 'ok', format })
    },
  )

  test.each([
    ['GIF', ascii('GIF89a......')],
    ['SVG', ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['HTML', ascii('<!doctype html><script>alert(1)</script>')],
    ['PDF', ascii('%PDF-1.7 ......')],
    ['plain text named .png', ascii('not a picture at all')],
    [
      'RIFF that is not WebP (WAV)',
      bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')),
    ],
    ['an ICO', bytes(0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0)],
    ['a PNG signature cut short', PNG.subarray(0, 5)],
    ['no bytes at all', new Uint8Array(0)],
  ])(
    'Given %s, When it is checked, Then it is refused as an unsupported type',
    (_, head) => {
      expect(pictureFormatOf(head)).toBeNull()
      expect(checkPictureFile(Math.max(head.length, 1), head)).toEqual({
        kind: 'refused',
        reason: 'unsupported_type',
      })
    },
  )
})

describe('F28-AC43: a picture is at most 1 MB', () => {
  test('Given a file of exactly 1 MB, When it is checked, Then it is accepted for reading', () => {
    expect(PICTURE_MAX_BYTES).toBe(1024 * 1024)
    expect(checkPictureFile(PICTURE_MAX_BYTES, PNG).kind).toBe('ok')
  })
  test('Given a file one byte over 1 MB, When it is checked, Then it is refused as too large before its type matters', () => {
    expect(checkPictureFile(PICTURE_MAX_BYTES + 1, PNG)).toEqual({
      kind: 'refused',
      reason: 'too_large',
    })
    expect(checkPictureFile(PICTURE_MAX_BYTES + 1, ascii('GIF89a')).kind).toBe(
      'refused',
    )
  })
  test('Given an empty file, When it is checked, Then it is refused as no file', () => {
    expect(checkPictureFile(0, new Uint8Array(0))).toEqual({
      kind: 'refused',
      reason: 'no_file',
    })
  })
})

describe('F28-AC44: the sides of a picture are bounded', () => {
  test.each([
    [1, 1, true],
    [8192, 8192, true],
    [8193, 10, false],
    [10, 8193, false],
    [0, 10, false],
    [-1, 10, false],
    [10.5, 10, false],
    [Number.NaN, 10, false],
  ])('Given %d by %d, When it is measured, Then it is %s', (w, h, ok) => {
    expect(withinPictureSides(w, h)).toBe(ok)
  })
})
