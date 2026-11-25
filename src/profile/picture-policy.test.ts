import { describe, expect, test } from 'vitest'
import {
  PICTURE_MAX_BYTES,
  PICTURE_MAX_SIDE,
  PICTURE_PNG_MAX_BYTES,
  PICTURE_SIDE,
  servedPictureType,
} from './picture-policy'

describe('the bounds of a profile picture', () => {
  test('Given the bounds, When they are read, Then a chosen file is 1 MB and 8192 pixels a side at most, and a stored PNG is 256 square and 512 KB at most', () => {
    expect(PICTURE_MAX_BYTES).toBe(1024 * 1024)
    expect(PICTURE_MAX_SIDE).toBe(8192)
    expect(PICTURE_SIDE).toBe(256)
    expect(PICTURE_PNG_MAX_BYTES).toBe(512 * 1024)
  })

  test('Given a 256 by 256 picture in 8-bit RGBA, When its rows are written with no compression at all, Then they fit within the stored bound with room to spare', () => {
    // One filter byte a row, then four bytes a pixel.
    const raw = PICTURE_SIDE * (1 + PICTURE_SIDE * 4)
    expect(raw).toBe(262400)
    // A stored deflate block holds 65,535 bytes and costs five more; the
    // zlib stream adds six, and the signature and chunks under a hundred.
    const written = raw + Math.ceil(raw / 65535) * 5 + 6 + 100
    expect(written).toBeLessThan(PICTURE_PNG_MAX_BYTES / 1.9)
  })
})

describe('F28-AC100: the type a stored picture is served as', () => {
  test.each([
    ['a PNG stored now', 'image/png', 'image/png'],
    ['a WebP stored before', 'image/webp', 'image/webp'],
    ['an object that says nothing', undefined, 'image/webp'],
    ['an object that says HTML', 'text/html', 'image/webp'],
    ['an object that says SVG', 'image/svg+xml', 'image/webp'],
    ['PNG with a parameter', 'image/png; charset=utf-8', 'image/webp'],
    ['PNG in capitals', 'IMAGE/PNG', 'image/webp'],
  ])(
    'Given %s, When it is served, Then its type is %s',
    (_, stored, served) => {
      expect(servedPictureType(stored)).toBe(served)
    },
  )
})
