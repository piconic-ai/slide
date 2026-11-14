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

/** Link targets as authors write them: quoted href values of any tag. */
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi

/**
 * The citation a link target makes, or null when it does not name a deck
 * under the service's origin. Only the canonical spelling counts, so one
 * deck is never cited under two names.
 */
export function citationOfHref(
  href: string,
  publicOrigin: string,
): Citation | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    // Relative links stay inside the citing deck's own origin.
    return null
  }
  if (url.origin !== new URL(publicOrigin).origin) return null
  const path = parseSharePath(url.pathname)
  if (path.kind === 'deck')
    return { handle: path.handle, slug: path.slug, page: 0 }
  if (path.kind === 'page')
    return { handle: path.handle, slug: path.slug, page: path.page }
  return null
}

/**
 * The decks and pages an HTML text links to under the service's origin, in
 * document order without repeats. Links are read wherever they are written,
 * including in fragments a deck loads later, so the text need not be a whole
 * document.
 */
export function citationsOf(html: string, publicOrigin: string): Citation[] {
  const found = new Map<string, Citation>()
  for (const match of html.matchAll(HREF)) {
    const citation = citationOfHref(
      decodeHTML(match[1] ?? match[2] ?? '').trim(),
      publicOrigin,
    )
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
