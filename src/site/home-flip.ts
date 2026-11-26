import { EMBED_PREFIX } from '../embed/code'
import { COMPACT_SHAPE } from '../embed/shape'

/**
 * Turning a card of the timeline into its slides (F44-AC27): which page the
 * card frames, and whether what came into the frame is the slides.
 */

/** The viewer path a card links to: `/@handle/slug`, with no page or query. */
const DECK_PATH = /^\/@[^/?#]+\/[^/?#]+$/

/**
 * The embed page to frame for the card whose viewer is at `href`: the
 * slides alone, with no line under them (F25-AC12). Null for anything that
 * is not the viewer of a deck, which no card turns into.
 */
export const flipFramePath = (href: string): string | null =>
  DECK_PATH.test(href) ? `${EMBED_PREFIX}${href}?t=${COMPACT_SHAPE}` : null

/** The part of a document the check below reads. */
export type FramedDocument = Readonly<{
  querySelector: (selector: string) => unknown
}>

/**
 * Whether the document that came into the frame is the embed page of public
 * slides, which holds the frame of the slides, `#deck`. A frame the browser
 * refused (the 404 of slides that are not public may not be framed), or
 * one whose document cannot be read, holds none.
 */
export const framesSlides = (doc: FramedDocument | null | undefined) =>
  doc !== null && doc !== undefined && doc.querySelector('iframe#deck') !== null
