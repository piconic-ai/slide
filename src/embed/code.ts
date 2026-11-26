import type { DeckSlug } from '../decks/deck-id'
import type { Handle } from '../share/handle'
import { sharePath } from '../share/path'

/** Under this prefix, a share path names the page made to be framed. */
export const EMBED_PREFIX = '/embed'

/** The path of the page to frame: the slides, or one of their pages. */
export const embedPath = (handle: Handle, slug: DeckSlug, page?: number) =>
  `${EMBED_PREFIX}${sharePath(handle, slug, page)}`

/** The size a frame's attributes name, in pixels. */
export type EmbedSize = Readonly<{ width: number; height: number }>

/**
 * The slides are 16:9 at the width of the frame, and the line under them
 * (the title, the author and the link to the viewer, with its border) adds
 * a fixed height. The embed page lays the line out at this height.
 */
export const EMBED_LINE_HEIGHT = 45

/** The height of 16:9 slides this wide, in whole pixels, at least one. */
export const slidesHeightAt = (width: number) =>
  Math.max(1, Math.floor((width * 9) / 16))

/**
 * The size of a frame this wide: the slides at 16:9 and the line under
 * them.
 */
export const embedSizeAt = (width: number): EmbedSize => ({
  width,
  height: slidesHeightAt(width) + EMBED_LINE_HEIGHT,
})

/**
 * The width the code names for a site that drops the style, and the most
 * oEmbed reports. With the style kept, the frame is as wide as its column.
 */
export const EMBED_WIDTH = 960

/**
 * A value inside a double-quoted attribute. Control characters would let a
 * title break the one line of code an author pastes, so they become spaces.
 */
const attribute = (value: string) =>
  value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

/**
 * The code an author pastes into another site: a box as wide as its
 * column, as tall as 16:9 slides plus the line under them, and one frame
 * that fills it. A height cannot add pixels to a ratio by itself, so the
 * box's padding, a share of its width, makes it. `src` is the page to
 * frame, and `title` names the frame for a screen reader. The frame is
 * fetched when the reader nears it. `size` is what the frame's attributes
 * name, for a site that drops the style; a consumer of oEmbed that gave
 * limits gets a size within them.
 */
export const embedCode = (
  view: Readonly<{ src: string; title: string; size?: EmbedSize }>,
) => {
  const { width, height } = view.size ?? embedSizeAt(EMBED_WIDTH)
  return `<div style="position:relative;padding-top:calc(56.25% + ${EMBED_LINE_HEIGHT}px)"><iframe src="${attribute(view.src)}" title="${attribute(view.title)}" loading="lazy" width="${width}" height="${height}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" allowfullscreen></iframe></div>`
}

/**
 * The embed code of the slides a share URL names. `shareUrl` is the URL of
 * the slides as a whole, so the code starts on the first page. Without
 * `size` this is the code an author copies.
 */
export function embedCodeOf(shareUrl: string, title: string, size?: EmbedSize) {
  const url = new URL(shareUrl)
  return embedCode({
    src: `${url.origin}${EMBED_PREFIX}${url.pathname}`,
    title,
    size,
  })
}
