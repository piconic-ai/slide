/** The largest picture that may be uploaded, in bytes (D-34). */
export const PICTURE_MAX_BYTES = 1024 * 1024

/** The side of the square a picture is shrunk to, in pixels. */
export const PICTURE_SIDE = 256

/** No side of an uploaded picture may be longer than this, in pixels. */
export const PICTURE_MAX_SIDE = 8192

export type PictureFormat = 'png' | 'jpeg' | 'webp'

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  signature.every((byte, index) => bytes[at + index] === byte)

/**
 * What kind of picture the bytes are, read from their first bytes and not
 * from the name or the type the browser reported. Only PNG, JPEG and WebP
 * are pictures here; anything else, SVG and GIF included, is null.
 */
export function pictureFormatOf(bytes: Uint8Array): PictureFormat | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  // RIFF, a 4-byte size, then WEBP.
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return 'webp'
  return null
}

/** Why an uploaded file cannot become a profile picture. */
export type PictureRefusal =
  | 'no_file'
  | 'too_large'
  | 'unsupported_type'
  | 'unreadable'
  | 'too_wide'
  /** No image service is set up here, or it cannot read this kind. */
  | 'unavailable'

export type PictureCheck =
  | Readonly<{ kind: 'ok'; format: PictureFormat }>
  | Readonly<{ kind: 'refused'; reason: PictureRefusal }>

/**
 * Whether a file may be tried as a picture: it is there, within 1 MB, and
 * its first bytes are those of a PNG, JPEG or WebP. Whether the rest can be
 * read as an image is for the image service to say.
 */
export function checkPictureFile(size: number, head: Uint8Array): PictureCheck {
  if (size === 0) return { kind: 'refused', reason: 'no_file' }
  if (size > PICTURE_MAX_BYTES) return { kind: 'refused', reason: 'too_large' }
  const format = pictureFormatOf(head)
  if (format === null) return { kind: 'refused', reason: 'unsupported_type' }
  return { kind: 'ok', format }
}

/** Whether a picture of this size may be shrunk: every side is bounded. */
export const withinPictureSides = (width: number, height: number) =>
  Number.isInteger(width) &&
  Number.isInteger(height) &&
  width > 0 &&
  height > 0 &&
  width <= PICTURE_MAX_SIDE &&
  height <= PICTURE_MAX_SIDE

/** What shrinking a picture to a square gave. */
export type SquarePicture =
  | Readonly<{ kind: 'ok'; bytes: Uint8Array; contentType: string }>
  | Readonly<{
      kind: 'refused'
      reason: Extract<PictureRefusal, 'unreadable' | 'too_wide' | 'unavailable'>
    }>

/** The one way pictures are shrunk, whatever does the shrinking. */
export type PictureShrinker = (bytes: Uint8Array) => Promise<SquarePicture>
