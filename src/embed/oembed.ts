import type { DeckSlug } from '../decks/deck-id'
import type { Handle } from '../share/handle'
import { parseSharePath } from '../share/path'
import { SERVICE_NAME } from '../site/service'
import {
  EMBED_LINE_HEIGHT,
  EMBED_WIDTH,
  embedSizeAt,
  type EmbedSize,
} from './code'

/** Where a site asks how to embed a share URL; see https://oembed.com. */
export const OEMBED_PATH = '/oembed'

/**
 * The slides a consumer asks about: `input` must be a share URL of this
 * service in its one spelling, of the slides or of one of their pages. A
 * profile, another site's URL or anything else names nothing.
 */
export function parseOEmbedUrl(
  input: unknown,
  publicOrigin: string,
): Readonly<{ handle: Handle; slug: DeckSlug }> | null {
  if (typeof input !== 'string' || !URL.canParse(input)) return null
  const url = new URL(input)
  if (url.origin !== new URL(publicOrigin).origin) return null
  if (url.username || url.password) return null
  const path = parseSharePath(url.pathname)
  return path.kind === 'deck' || path.kind === 'page'
    ? { handle: path.handle, slug: path.slug }
    : null
}

/**
 * A limit a consumer gave, in whole pixels: no limit when it gave none, and
 * null when what it gave is no positive number. A measured width may carry
 * a fraction, which is dropped, so the limit is never exceeded.
 */
function limit(value: unknown): number | null {
  if (value === undefined) return Infinity
  if (typeof value !== 'string' || !/^[0-9]{1,9}(\.[0-9]{1,9})?$/.test(value))
    return null
  const pixels = Math.floor(Number(value))
  return pixels >= 1 ? pixels : null
}

/**
 * The size to report and to name in the code: 16:9 slides and the line
 * under them, as large as the embed code's own size and never larger than
 * `maxwidth` and `maxheight` allow. Null when a limit was given that is no
 * positive number of pixels, or a height with no room for slides above the
 * line: no size can be promised to fit it.
 */
export function oembedSize(
  maxwidth: unknown,
  maxheight: unknown,
): EmbedSize | null {
  const [widest, tallest] = [limit(maxwidth), limit(maxheight)]
  if (widest === null || tallest === null) return null
  const width = Math.min(
    EMBED_WIDTH,
    widest,
    Math.floor(((tallest - EMBED_LINE_HEIGHT) * 16) / 9),
  )
  return width >= 1 ? embedSizeAt(width) : null
}

/** Why limits that no size fits are refused. */
export const OEMBED_LIMIT_ERROR = `maxwidth and maxheight must be positive numbers, and maxheight more than ${EMBED_LINE_HEIGHT}`

/** The answer about public slides: rich content, shown with `html`. */
export const oembedResponse = (
  view: Readonly<{
    /** The embed code, naming the size reported. */
    html: string
    title: string
    authorName: string
    authorUrl: string
    publicOrigin: string
    size: EmbedSize
  }>,
) => ({
  type: 'rich',
  version: '1.0',
  title: view.title,
  author_name: view.authorName,
  author_url: view.authorUrl,
  provider_name: SERVICE_NAME,
  provider_url: new URL(view.publicOrigin).origin,
  html: view.html,
  width: view.size.width,
  height: view.size.height,
})

/** The address a consumer finds in the viewer's head, for these slides. */
export const oembedUrl = (shareUrl: string) =>
  `${new URL(shareUrl).origin}${OEMBED_PATH}?${new URLSearchParams({ url: shareUrl, format: 'json' })}`
