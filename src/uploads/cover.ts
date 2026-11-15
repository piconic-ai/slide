import { decodeHTMLAttribute } from 'entities'
import { metasOf } from './description'

/** Cover paths longer than this are not taken. */
export const COVER_PATH_MAX_LENGTH = 300

/** The image types that services previewing links accept. */
const COVER_FILE = /\.(?:png|jpe?g|webp|gif)$/i

/** Stands for the deployment's own origin, which no deck can know. */
const DECK = 'https://deck.invalid/'

/** The path in the deployment a URL written in index.html names, or null. */
function pathInDeck(written: string): string | null {
  // Only a relative reference stays in the deck wherever it is served.
  if (/^\s*(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i.test(written)) return null
  try {
    const url = new URL(written, DECK)
    if (url.origin !== new URL(DECK).origin) return null
    // Stored paths are NFC; see pathSchema in inventory.ts.
    return decodeURIComponent(url.pathname.slice(1)).normalize('NFC')
  } catch {
    return null
  }
}

/**
 * The image an HTML document names as its cover in its first
 * <meta property="og:image"> that points at an image file of the deck
 * itself, as a path from the deck's root, or null. An image elsewhere is
 * not taken: the service shows only files it stores. Whether the deck has
 * the file is the caller's check; a later og:image is not tried when it
 * has not.
 */
export function coverPathOf(html: string): string | null {
  for (const attributes of metasOf(html)) {
    const key = attributes.get('property') ?? attributes.get('name')
    if (key?.toLowerCase() !== 'og:image') continue
    const path = pathInDeck(
      decodeHTMLAttribute(attributes.get('content') ?? '').trim(),
    )
    if (path && path.length <= COVER_PATH_MAX_LENGTH && COVER_FILE.test(path))
      return path
  }
  return null
}
