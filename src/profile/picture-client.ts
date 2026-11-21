import {
  PICTURE_SIDE,
  withinPictureSides,
  type PictureShrinker,
} from './picture-policy'

const streamOf = (bytes: Uint8Array) => new Blob([bytes as BlobPart]).stream()

/**
 * Shrinks a picture to a square of PICTURE_SIDE pixels, cut from the middle,
 * and writes it as WebP. The output carries no metadata of the original (the
 * place a photo was taken, say), and the original is not kept. A picture the
 * image service cannot read, however it came to be broken, is `unreadable`.
 */
export const imagesShrinker =
  (images: ImagesBinding): PictureShrinker =>
  async (bytes) => {
    try {
      const info = await images.info(streamOf(bytes))
      // An SVG has no pixels to measure, and is not a picture here.
      if (!('width' in info)) return { kind: 'refused', reason: 'unreadable' }
      if (!withinPictureSides(info.width, info.height))
        return { kind: 'refused', reason: 'too_wide' }
      const result = await images
        .input(streamOf(bytes))
        .transform({ width: PICTURE_SIDE, height: PICTURE_SIDE, fit: 'cover' })
        .output({ format: 'image/webp', quality: 85 })
      return {
        kind: 'ok',
        bytes: new Uint8Array(await result.response().arrayBuffer()),
        contentType: result.contentType(),
      }
    } catch {
      return { kind: 'refused', reason: 'unreadable' }
    }
  }
