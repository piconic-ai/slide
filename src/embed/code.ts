import type { DeckSlug } from '../decks/binding'
import type { Handle } from '../share/handle'
import { sharePath } from '../share/path'

/** Under this prefix, a share path names the page made to be framed. */
export const EMBED_PREFIX = '/embed'

/** The path of the page to frame: the slides, or one of their pages. */
export const embedPath = (handle: Handle, slug: DeckSlug, page?: number) =>
  `${EMBED_PREFIX}${sharePath(handle, slug, page)}`

/**
 * The size the code names for a site that drops its style: 16:9. With the
 * style kept, the frame is as wide as its column instead.
 */
export const EMBED_WIDTH = 960
export const EMBED_HEIGHT = 540

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

/** The size a frame's attributes name, in pixels. */
export type EmbedSize = Readonly<{ width: number; height: number }>

/**
 * The code an author pastes into another site: one frame that stays 16:9 at
 * the width of its column. `src` is the page to frame, and `title` names
 * the frame for a screen reader. The frame is fetched when the reader
 * nears it. `size` is what the attributes name, for a site that drops the
 * style; a consumer of oEmbed that gave limits gets a size within them.
 */
export const embedCode = (
  view: Readonly<{ src: string; title: string; size?: EmbedSize }>,
) => {
  const { width, height } = view.size ?? {
    width: EMBED_WIDTH,
    height: EMBED_HEIGHT,
  }
  return `<iframe src="${attribute(view.src)}" title="${attribute(view.title)}" loading="lazy" width="${width}" height="${height}" style="width:100%;height:auto;aspect-ratio:16/9;border:0" allowfullscreen></iframe>`
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
