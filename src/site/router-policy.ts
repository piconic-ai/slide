/**
 * Which links the page's router takes over. A move between the service's
 * pages replaces the page inside the frame; every other move is the
 * browser's own, a whole page load.
 *
 * Pure: the entry (`router-entry.ts`) reads a link and passes what it found,
 * so the decision is tested without a browser.
 */

/**
 * Paths whose answer is not a page to put in the frame: signing in and out
 * and leaving the service change who the visitor is, so the header and the
 * page are read again; the rest answer with data or a document of their own.
 */
const WHOLE_PAGE_PREFIXES = [
  '/auth/',
  '/account/',
  '/api/',
  '/oauth/',
  '/mcp',
  '/oembed',
  '/embed/',
  '/uploads/',
] as const

/** What a link says about itself, as the entry read it. */
export type LinkFacts = Readonly<{
  /** The link's resolved address. */
  href: string
  /** The address of the page the link is on. */
  from: string
  /** The `data-bf-router` attribute: `false` hands the link to the browser. */
  router: string | undefined
  download: boolean
  target: string | null
  rel: string | null
}>

const startsWithAny = (path: string) =>
  WHOLE_PAGE_PREFIXES.some((prefix) => path.startsWith(prefix))

/** Whether the router moves to this link's page inside the frame. */
export function movesInFrame(link: LinkFacts): boolean {
  if (link.router === 'false' || link.download) return false
  if (link.target && link.target !== '_self') return false
  if ((link.rel ?? '').split(/\s+/).includes('external')) return false
  let to: URL
  let from: URL
  try {
    to = new URL(link.href)
    from = new URL(link.from)
  } catch {
    return false
  }
  if (to.origin !== from.origin) return false
  // The language is read from the address, so the header and the footer
  // are worded again by a whole page load.
  if (to.searchParams.has('lang')) return false
  if (startsWithAny(to.pathname)) return false
  // A link to a place on the same page is the browser's to scroll to.
  return !(
    to.hash &&
    to.pathname === from.pathname &&
    to.search === from.search
  )
}
