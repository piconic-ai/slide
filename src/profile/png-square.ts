import { crc32, deflate, inflate } from './png-codec'
import {
  PICTURE_SIDE,
  withinPictureSides,
  type SquarePicture,
} from './picture-policy'

/** The most pixels the local shrinker decodes (RGBA takes 4 bytes each). */
const MAX_PIXELS = 16_000_000

type Decoded = Readonly<{ width: number; height: number; rgba: Uint8Array }>

const u32 = (bytes: Uint8Array, at: number) =>
  ((bytes[at]! << 24) |
    (bytes[at + 1]! << 16) |
    (bytes[at + 2]! << 8) |
    bytes[at + 3]!) >>>
  0

/** Samples per pixel for the colour types this shrinker reads. */
const CHANNELS: Readonly<Record<number, number>> = {
  0: 1,
  2: 3,
  3: 1,
  4: 2,
  6: 4,
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Undoes the row filters of a PNG's decompressed data, in place. */
function unfilter(
  data: Uint8Array,
  width: number,
  height: number,
  bpp: number,
) {
  const stride = width * bpp
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)]!
    const src = y * (stride + 1) + 1
    for (let x = 0; x < stride; x++) {
      const raw = data[src + x]!
      const left = x >= bpp ? out[y * stride + x - bpp]! : 0
      const up = y > 0 ? out[(y - 1) * stride + x]! : 0
      const upLeft = y > 0 && x >= bpp ? out[(y - 1) * stride + x - bpp]! : 0
      const add =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : paeth(left, up, upLeft)
      out[y * stride + x] = (raw + add) & 0xff
    }
  }
  return out
}

/**
 * Reads an 8-bit, non-interlaced PNG into RGBA. Anything else, or anything
 * broken, is null.
 */
async function decodePng(bytes: Uint8Array): Promise<Decoded | null> {
  let at = 8
  let header: { width: number; height: number; type: number } | null = null
  let palette: Uint8Array | null = null
  const parts: Uint8Array[] = []
  while (at + 12 <= bytes.length) {
    const length = u32(bytes, at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (body.length !== length) return null
    if (type === 'IHDR') {
      if (length !== 13 || body[8] !== 8 || body[12] !== 0) return null
      header = { width: u32(body, 0), height: u32(body, 4), type: body[9]! }
    } else if (type === 'PLTE') palette = body
    else if (type === 'IDAT') parts.push(body)
    else if (type === 'IEND') break
    at += 12 + length
  }
  if (!header || parts.length === 0) return null
  const { width, height, type } = header
  const channels = CHANNELS[type]
  if (
    !channels ||
    !withinPictureSides(width, height) ||
    width * height > MAX_PIXELS
  )
    return null
  if (type === 3 && !palette) return null
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  const data = await inflate(joined)
  if (!data || data.length !== (width * channels + 1) * height) return null
  const pixels = unfilter(data, width, height, channels)
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const p = i * channels
    let r: number,
      g: number,
      b: number,
      a = 255
    if (type === 0 || type === 4) {
      r = g = b = pixels[p]!
      if (type === 4) a = pixels[p + 1]!
    } else if (type === 3) {
      const index = pixels[p]! * 3
      if (index + 2 >= palette!.length) return null
      r = palette![index]!
      g = palette![index + 1]!
      b = palette![index + 2]!
    } else {
      r = pixels[p]!
      g = pixels[p + 1]!
      b = pixels[p + 2]!
      if (type === 6) a = pixels[p + 3]!
    }
    rgba.set([r, g, b, a], i * 4)
  }
  return { width, height, rgba }
}

/** The middle square of the picture, sampled down (or up) to the side. */
function square({ width, height, rgba }: Decoded): Uint8Array {
  const side = Math.min(width, height)
  const x0 = Math.floor((width - side) / 2)
  const y0 = Math.floor((height - side) / 2)
  const out = new Uint8Array(PICTURE_SIDE * PICTURE_SIDE * 4)
  for (let y = 0; y < PICTURE_SIDE; y++)
    for (let x = 0; x < PICTURE_SIDE; x++) {
      const sx =
        x0 + Math.min(side - 1, Math.floor(((x + 0.5) * side) / PICTURE_SIDE))
      const sy =
        y0 + Math.min(side - 1, Math.floor(((y + 0.5) * side) / PICTURE_SIDE))
      const from = (sy * width + sx) * 4
      out.set(rgba.subarray(from, from + 4), (y * PICTURE_SIDE + x) * 4)
    }
  return out
}

const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  const body = new Uint8Array(4 + data.length)
  body.set(new TextEncoder().encode(type))
  body.set(data, 4)
  out.set(body, 4)
  view.setUint32(8 + data.length, crc32(body))
  return out
}

/** A PNG of the RGBA pixels, with no metadata of any original. */
async function encodePng(rgba: Uint8Array, side: number): Promise<Uint8Array> {
  const rows = new Uint8Array((side * 4 + 1) * side)
  for (let y = 0; y < side; y++)
    rows.set(
      rgba.subarray(y * side * 4, (y + 1) * side * 4),
      y * (side * 4 + 1) + 1,
    )
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, side)
  view.setUint32(4, side)
  header.set([8, 6, 0, 0, 0], 8)
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', await deflate(rows)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * The shrinker for local development and tests, where no Images binding
 * exists. It reads 8-bit PNGs only and writes a 256 pixel square PNG; a JPEG
 * or WebP is `unavailable` here, as it would be anywhere with no image
 * service. It keeps no metadata and never stores the original.
 */
export async function squarePng(bytes: Uint8Array): Promise<SquarePicture> {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
  if (!isPng) return { kind: 'refused', reason: 'unavailable' }
  const decoded = await decodePng(bytes).catch(() => null)
  if (!decoded) return { kind: 'refused', reason: 'unreadable' }
  return {
    kind: 'ok',
    bytes: await encodePng(square(decoded), PICTURE_SIDE),
    contentType: 'image/png',
  }
}
