import { decodeHTML } from 'entities'
import { parseSharePath } from '../share/path'

/** A share URL another deck links to; page 0 names the whole deck. */
export type Citation = Readonly<{
  handle: string
  slug: string
  page: number
}>

/** How many distinct citations one deployment keeps. */
export const MAX_CITATIONS = 100

/**
 * Link targets as authors write them: the href values of any tag, quoted or,
 * as minified HTML leaves them, bare.
 */
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/gi

/**
 * How many link targets under the service's origin one text may have
 * examined. A deck keeps at most MAX_CITATIONS, so a text with more links
 * than this is not written by a person, and the rest is left unread.
 */
export const MAX_LINKS_EXAMINED = 2000

/**
 * Whether a link target is written under the service's origin. Parsing a
 * target that is no URL fails slowly, and a text may hold over a million of
 * them, so only targets that pass this cheap look are parsed.
 */
const underOrigin = (href: string, origin: string) =>
  href.length > origin.length &&
  href[origin.length] === '/' &&
  href.slice(0, origin.length).toLowerCase() === origin

/** The deck or page a path names, following a spelling the viewer redirects. */
function citationOfPath(pathname: string): Citation | null {
  const first = parseSharePath(pathname)
  const path = first.kind === 'redirect' ? parseSharePath(first.path) : first
  if (path.kind === 'deck')
    return { handle: path.handle, slug: path.slug, page: 0 }
  if (path.kind === 'page')
    return { handle: path.handle, slug: path.slug, page: path.page }
  return null
}

/**
 * The citation a link target makes, or null when it does not name a deck
 * under the service's origin. A spelling the viewer would redirect (a handle
 * in upper case, a trailing slash, an encoded at sign) cites the deck under
 * its one canonical name, so a deck is never cited under two names. The
 * origin must be written as the service writes it, without a port.
 */
export function citationOfHref(
  href: string,
  publicOrigin: string,
): Citation | null {
  return citationUnder(href, new URL(publicOrigin).origin)
}

function citationUnder(href: string, origin: string): Citation | null {
  if (!underOrigin(href, origin)) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  return url.origin === origin ? citationOfPath(url.pathname) : null
}

/**
 * The decks and pages an HTML text links to under the service's origin, in
 * document order without repeats. Links are read wherever they are written,
 * including in fragments a deck loads later and in markup a script holds as
 * it would stand in a page, so the text need not be a whole document, nor
 * well formed. The text is not parsed as HTML: a link inside a comment
 * counts as well, and a link a script holds escaped or as data does not.
 *
 * `cut` tells that the text is only the head of a longer one. A bare link
 * target that runs to the very end may then be the start of another, so it
 * is left out.
 */
export function citationsOf(
  html: string,
  publicOrigin: string,
  { cut = false }: Readonly<{ cut?: boolean }> = {},
): Citation[] {
  const origin = new URL(publicOrigin).origin
  const found = new Map<string, Citation>()
  let examined = 0
  for (const match of html.matchAll(HREF)) {
    const bare = match[3]
    if (
      cut &&
      bare !== undefined &&
      match.index + match[0].length === html.length
    )
      continue
    const href = decodeHTML(match[1] ?? match[2] ?? bare ?? '').trim()
    if (!underOrigin(href, origin)) continue
    if (examined === MAX_LINKS_EXAMINED) break
    examined += 1
    const citation = citationUnder(href, origin)
    if (!citation) continue
    const key = `${citation.handle}/${citation.slug}/${citation.page}`
    if (!found.has(key)) found.set(key, citation)
  }
  return [...found.values()]
}

/**
 * The citations a deployment keeps from all of its HTML files: without
 * repeats, without links to the deck itself, and at most MAX_CITATIONS.
 */
export function mergeCitations(
  perFile: readonly (readonly Citation[])[],
  self: Readonly<{ handle: string | null; slug: string | null }>,
): Citation[] {
  const found = new Map<string, Citation>()
  for (const citation of perFile.flat()) {
    if (citation.handle === self.handle && citation.slug === self.slug) continue
    const key = `${citation.handle}/${citation.slug}/${citation.page}`
    if (!found.has(key)) found.set(key, citation)
  }
  return [...found.values()].slice(0, MAX_CITATIONS)
}
