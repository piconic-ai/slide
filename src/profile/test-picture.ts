import { deflateSync } from 'node:zlib'
import { crc32 } from './picture-png'

export const PNG_SIGNATURE = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

/** One PNG chunk: its length, type, data and the CRC of type and data. */
export function pngChunk(type: string, data: Uint8Array = new Uint8Array(0)) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), 8 + data.length)
  return new Uint8Array(out)
}

/** The IHDR data of a picture: size, bit depth, colour type, interlace. */
export function pngHeader(
  width: number,
  height: number,
  { depth = 8, colorType = 2, interlace = 0 } = {},
) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([depth, colorType, 0, 0, interlace], 8)
  return new Uint8Array(header)
}

/** The compressed rows of a solid grey RGB picture. */
export function pngPixels(width: number, height: number) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)])
  return new Uint8Array(
    deflateSync(Buffer.concat(Array.from({ length: height }, () => row))),
  )
}

/** The signature followed by the given chunks, as they are. */
export const pngOf = (...chunks: Uint8Array[]) =>
  new Uint8Array(Buffer.concat([PNG_SIGNATURE, ...chunks]))

/** A solid-colour PNG of the given size, made without any image library. */
export function png(width: number, height: number): Uint8Array {
  return pngOf(
    pngChunk('IHDR', pngHeader(width, height)),
    pngChunk('IDAT', pngPixels(width, height)),
    pngChunk('IEND'),
  )
}

/** The picture the settings page sends: a 256 by 256 PNG. */
export const squarePng = () => png(256, 256)

/** The chunk types of a PNG, in order, read without checking anything. */
export function chunkTypes(bytes: Uint8Array): string[] {
  const view = Buffer.from(bytes)
  const types: string[] = []
  for (let at = 8; at + 8 <= view.length;) {
    types.push(view.toString('latin1', at + 4, at + 8))
    at += 12 + view.readUInt32BE(at)
  }
  return types
}

/**
 * The JPEG with an EXIF segment put right after its start: the orientation
 * (6 turns it a quarter clockwise to show) and a description, which stands
 * for the metadata a camera writes, such as the place a photo was taken.
 */
export function withExif(
  jpeg: Uint8Array,
  orientation: number,
  description: string,
): Uint8Array {
  const text = Buffer.from(`${description}\0`, 'latin1')
  // The TIFF header, one directory of two entries, and the text after it.
  const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4 + text.length)
  tiff.write('MM', 0, 'latin1')
  tiff.writeUInt16BE(42, 2)
  tiff.writeUInt32BE(8, 4)
  tiff.writeUInt16BE(2, 8)
  // ImageDescription (0x010e), ASCII, pointing at the text.
  tiff.writeUInt16BE(0x010e, 10)
  tiff.writeUInt16BE(2, 12)
  tiff.writeUInt32BE(text.length, 14)
  tiff.writeUInt32BE(38, 18)
  // Orientation (0x0112), one SHORT held in the entry itself.
  tiff.writeUInt16BE(0x0112, 22)
  tiff.writeUInt16BE(3, 24)
  tiff.writeUInt32BE(1, 26)
  tiff.writeUInt16BE(orientation, 30)
  tiff.writeUInt32BE(0, 34)
  text.copy(tiff, 38)
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const segment = Buffer.alloc(4)
  segment.writeUInt16BE(0xffe1, 0)
  segment.writeUInt16BE(body.length + 2, 2)
  return new Uint8Array(
    Buffer.concat([jpeg.subarray(0, 2), segment, body, jpeg.subarray(2)]),
  )
}

/** A PNG with a text chunk after its header, as a photo editor might write. */
export function withPngText(picture: Uint8Array, text: string): Uint8Array {
  const headerEnd = 8 + 25
  return new Uint8Array(
    Buffer.concat([
      picture.subarray(0, headerEnd),
      pngChunk('tEXt', Buffer.from(`Comment\0${text}`, 'latin1')),
      picture.subarray(headerEnd),
    ]),
  )
}
