import { PICTURE_PNG_MAX_BYTES, PICTURE_SIDE } from './picture-policy'

/**
 * The service keeps only what the settings page sends: a PNG of exactly
 * PICTURE_SIDE by PICTURE_SIDE pixels that the browser drew and wrote. The
 * bytes are not trusted for that: their structure is read here, chunk by
 * chunk, and only the chunks a picture needs to be shown are kept. The pixels
 * are not decoded; a PNG whose image data is broken shows as no picture, and
 * the initial under it shows instead.
 */

const SIGNATURE: readonly number[] = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]

/** Length, type and CRC around each chunk's data, in bytes. */
const CHUNK_FRAME = 12

/**
 * More chunks than any browser writes for a picture this small: one 8 KB
 * image chunk after another fills the largest stored picture in 64.
 */
export const PNG_MAX_CHUNKS = 1024

/**
 * The chunks kept besides IHDR, PLTE, IDAT and IEND: transparency, and how
 * the colours are meant. An embedded colour profile (iCCP) is left out: it
 * is a compressed blob every viewer's browser would parse, and a canvas
 * drawn in sRGB does not need one. Text, EXIF, times, sizes for print,
 * animation frames and everything else are left out too.
 */
const KEPT_BEFORE_DATA = new Set(['tRNS', 'gAMA', 'cHRM', 'sRGB'])

/** The critical chunks a decoder knows; any other one cannot be shown. */
const CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND'])

/** Why the bytes are not a picture the service keeps. */
export type PngRefusal =
  | 'not_png'
  | 'too_large'
  | 'truncated'
  | 'bad_chunk_type'
  | 'bad_crc'
  | 'too_many_chunks'
  | 'no_end'
  | 'trailing_bytes'
  | 'bad_header'
  | 'wrong_size'
  | 'bad_order'
  | 'unknown_critical'

export type PngCheck =
  | Readonly<{ kind: 'ok'; bytes: Uint8Array }>
  | Readonly<{ kind: 'refused'; reason: PngRefusal }>

type Chunk = Readonly<{
  type: string
  /** Where the chunk starts (its length field) and where it ends (after its CRC). */
  start: number
  end: number
}>

type Read<T> =
  | Readonly<{ kind: 'ok'; value: T }>
  | Readonly<{ kind: 'refused'; reason: PngRefusal }>

const refused = (reason: PngRefusal) => ({ kind: 'refused', reason }) as const

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** The CRC-32 a PNG chunk carries, over its type and data. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const isLetter = (byte: number) =>
  (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)

const hasSignature = (bytes: Uint8Array) =>
  bytes.length >= SIGNATURE.length &&
  SIGNATURE.every((byte, index) => bytes[index] === byte)

/** One chunk at `offset`, checked for its length, type and CRC. */
function readChunk(bytes: Uint8Array, offset: number): Read<Chunk> {
  if (bytes.length - offset < CHUNK_FRAME) return refused('truncated')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const length = view.getUint32(offset)
  // Compared before adding, so a length near 2^32 cannot wrap or allocate.
  if (length > bytes.length - offset - CHUNK_FRAME) return refused('truncated')
  const typeBytes = bytes.subarray(offset + 4, offset + 8)
  if (!typeBytes.every(isLetter)) return refused('bad_chunk_type')
  const end = offset + CHUNK_FRAME + length
  const stored = view.getUint32(end - 4)
  if (crc32(bytes.subarray(offset + 4, end - 4)) !== stored)
    return refused('bad_crc')
  const type = String.fromCharCode(...typeBytes)
  return { kind: 'ok', value: { type, start: offset, end } }
}

/**
 * Every chunk from the signature to IEND, which must end the bytes. Each
 * chunk is read once, so the time grows with the size and no more.
 */
function readChunks(bytes: Uint8Array): Read<readonly Chunk[]> {
  const chunks: Chunk[] = []
  let offset = SIGNATURE.length
  while (offset < bytes.length) {
    if (chunks.length === PNG_MAX_CHUNKS) return refused('too_many_chunks')
    const chunk = readChunk(bytes, offset)
    if (chunk.kind === 'refused') return chunk
    chunks.push(chunk.value)
    offset = chunk.value.end
    if (chunk.value.type === 'IEND') break
  }
  if (chunks.at(-1)?.type !== 'IEND') return refused('no_end')
  if (offset !== bytes.length) return refused('trailing_bytes')
  return { kind: 'ok', value: chunks }
}

/** The bit depths each colour type allows (PNG specification, 11.2.2). */
const DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
}

type Header = Readonly<{ colorType: number }>

/** The IHDR chunk: the size, and a combination of fields a decoder knows. */
function readHeader(
  bytes: Uint8Array,
  chunk: Chunk | undefined,
  fits: PngShape['fits'],
): Read<Header> {
  if (chunk?.type !== 'IHDR' || chunk.end - chunk.start !== CHUNK_FRAME + 13)
    return refused('bad_header')
  const view = new DataView(bytes.buffer, bytes.byteOffset + chunk.start + 8)
  const [depth, colorType, compression, filter, interlace] = bytes.subarray(
    chunk.start + 16,
    chunk.start + 21,
  )
  const known =
    DEPTHS[colorType!]?.includes(depth!) === true &&
    compression === 0 &&
    filter === 0 &&
    (interlace === 0 || interlace === 1)
  if (!known) return refused('bad_header')
  if (!fits(view.getUint32(0), view.getUint32(4))) return refused('wrong_size')
  return { kind: 'ok', value: { colorType: colorType! } }
}

const isCritical = (type: string) => type.charCodeAt(0) < 0x61

/**
 * Whether the chunks come in an order a decoder accepts: one header first,
 * no critical chunk it does not know, the palette where the colour type
 * needs one and before the image data, and the image data in one run.
 */
function checkOrder(
  chunks: readonly Chunk[],
  header: Header,
): PngRefusal | null {
  const types = chunks.map(({ type }) => type)
  if (types.some((type) => isCritical(type) && !CRITICAL.has(type)))
    return 'unknown_critical'
  const first = types.indexOf('IDAT')
  const last = types.lastIndexOf('IDAT')
  if (first < 0 || types.slice(first, last + 1).some((t) => t !== 'IDAT'))
    return 'bad_order'
  if (types.lastIndexOf('IHDR') !== 0) return 'bad_order'
  return checkPalette(types, header.colorType, first)
}

/** A palette is needed for colour type 3, allowed for 2 and 6, and once. */
function checkPalette(
  types: readonly string[],
  colorType: number,
  firstData: number,
): PngRefusal | null {
  const palettes = types.filter((type) => type === 'PLTE').length
  const needed = colorType === 3
  const allowed = needed || colorType === 2 || colorType === 6
  if (palettes > 1 || (needed && palettes === 0) || (!allowed && palettes > 0))
    return 'bad_order'
  if (palettes === 1 && types.indexOf('PLTE') > firstData) return 'bad_order'
  return null
}

/** The chunks a picture is shown with; the rest is left out. */
function keptChunks(chunks: readonly Chunk[]): readonly Chunk[] {
  const firstData = chunks.findIndex(({ type }) => type === 'IDAT')
  return chunks.filter(
    ({ type }, index) =>
      CRITICAL.has(type) || (KEPT_BEFORE_DATA.has(type) && index < firstData),
  )
}

/** The signature and the kept chunks, copied in order into one array. */
function joined(bytes: Uint8Array, chunks: readonly Chunk[]): Uint8Array {
  const size = chunks.reduce(
    (total, chunk) => total + chunk.end - chunk.start,
    SIGNATURE.length,
  )
  const out = new Uint8Array(size)
  out.set(SIGNATURE)
  let offset = SIGNATURE.length
  for (const chunk of chunks) {
    out.set(bytes.subarray(chunk.start, chunk.end), offset)
    offset += chunk.end - chunk.start
  }
  return out
}

/** What a kept PNG may be: its largest size in bytes, and its sides. */
export type PngShape = Readonly<{
  maxBytes: number
  fits: (width: number, height: number) => boolean
}>

/**
 * Whether the bytes are a PNG of the given shape, and if so, the same PNG
 * with only the chunks it is shown with: within `maxBytes`, every chunk
 * whole with a matching CRC, IHDR first (its sides as `fits` allows) and
 * IEND last with nothing after it. Text, EXIF and the like do not reach the
 * stored picture, whoever made the file.
 */
export function cleanPng(bytes: Uint8Array, shape: PngShape): PngCheck {
  if (bytes.length > shape.maxBytes) return refused('too_large')
  if (!hasSignature(bytes)) return refused('not_png')
  const chunks = readChunks(bytes)
  if (chunks.kind === 'refused') return chunks
  const header = readHeader(bytes, chunks.value[0], shape.fits)
  if (header.kind === 'refused') return header
  const disorder = checkOrder(chunks.value, header.value)
  if (disorder) return refused(disorder)
  return { kind: 'ok', bytes: joined(bytes, keptChunks(chunks.value)) }
}

/**
 * Whether the bytes are a picture the service keeps: a 256 by 256 PNG
 * within PICTURE_PNG_MAX_BYTES, cleaned as `cleanPng` cleans it.
 */
export const cleanPicturePng = (bytes: Uint8Array): PngCheck =>
  cleanPng(bytes, {
    maxBytes: PICTURE_PNG_MAX_BYTES,
    fits: (width, height) => width === PICTURE_SIDE && height === PICTURE_SIDE,
  })
