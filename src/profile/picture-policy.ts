/**
 * The largest file the settings page will shrink, in bytes. The browser
 * checks it before reading the file; the service never sees the original.
 * A Gravatar picture the service passes on is held to the same bound.
 */
export const PICTURE_MAX_BYTES = 1024 * 1024

/** The side of the square a picture is shrunk to, in pixels. */
export const PICTURE_SIDE = 256

/** No side of a chosen picture may be longer than this, in pixels. */
export const PICTURE_MAX_SIDE = 8192

/**
 * The largest PNG the service keeps, in bytes. A 256 by 256 picture with
 * 8-bit RGBA takes 262,400 bytes before compression, and a PNG written
 * without compressing it at all adds only a few bytes a block; this leaves
 * room for a colour profile as well, and bounds what one upload may store.
 */
export const PICTURE_PNG_MAX_BYTES = 512 * 1024

/**
 * Why the service did not keep a posted picture. The browser shrinks every
 * picture before sending it, so the service refuses anything that is not
 * such a picture with one reason: the page tells the author to choose again.
 */
export type PictureRefusal = 'no_file' | 'not_shrunk'

/** The types a stored picture is served as. */
export type StoredPictureType = 'image/png' | 'image/webp'

/**
 * The type a stored picture is served as, from what its object says. New
 * pictures are PNG; pictures stored before the browser shrank them are WebP,
 * and keep being served as they are. Anything else the object says is not
 * trusted, and is served as WebP, as those older pictures were.
 */
export const servedPictureType = (
  stored: string | undefined,
): StoredPictureType => (stored === 'image/png' ? 'image/png' : 'image/webp')
