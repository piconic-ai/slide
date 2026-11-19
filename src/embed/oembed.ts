import type { DeckSlug } from '../decks/binding'
import type { Handle } from '../share/handle'
import { parseSharePath } from '../share/path'
import { SERVICE_NAME } from '../site/service'
import { EMBED_HEIGHT, EMBED_WIDTH } from './code'

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

/** A limit a consumer gave, when it is a whole number of pixels. */
const limit = (value: unknown) =>
  typeof value === 'string' && /^[1-9][0-9]{0,5}$/.test(value)
    ? Number(value)
    : Infinity

/**
 * The size to report: 16:9, as large as the embed code's own size and no
 * larger than `maxwidth` and `maxheight` allow. A limit that is not a
 * positive whole number is ignored.
 */
export function oembedSize(maxwidth: unknown, maxheight: unknown) {
  const width = Math.max(
    1,
    Math.min(
      EMBED_WIDTH,
      limit(maxwidth),
      Math.floor((limit(maxheight) * EMBED_WIDTH) / EMBED_HEIGHT),
    ),
  )
  return {
    width,
    height: Math.max(1, Math.floor((width * EMBED_HEIGHT) / EMBED_WIDTH)),
  }
}

/** The answer about public slides: rich content, shown with `html`. */
export const oembedResponse = (
  view: Readonly<{
    /** The embed code, the same an author copies. */
    html: string
    title: string
    authorName: string
    authorUrl: string
    publicOrigin: string
    size: Readonly<{ width: number; height: number }>
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
