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

/** Splits a policy into its directives, in order: name and sources. */
const directivesOf = (policy: string): [string, string[]][] =>
  policy
    .split(';')
    .map((directive) => directive.trim().split(/\s+/))
    .filter(([name]) => name)
    .map(([name, ...sources]) => [name, sources])

/** The sources a directive keeps, and the ones that must be added to it. */
const withSources = (
  directives: [string, string[]][],
  name: string,
  add: readonly string[],
  /** Sources that are dropped: `'none'` stands alone. */
  drop: readonly string[] = ["'none'"],
) => {
  const found = directives.find(([key]) => key === name)
  if (!found) return directives.push([name, [...add]])
  const kept = found[1].filter((source) => !drop.includes(source))
  found[1] = [...new Set([...kept, ...add])]
}

/**
 * The policy of a page the router can move into the frame. A page keeps the
 * policy of the document that was loaded whole, so after a move the new page
 * runs under the old page's policy. Every page that carries the router
 * therefore allows what any other such page needs: forms to the service,
 * GitHub's sign-in and a deck's own origin (an author's slides start from a
 * form), frames and pictures of the decks' origins, and the author's picture.
 * The deck's origin is a wildcard, as the top page already allows for covers,
 * since the page that moves in names a deck the first one does not know.
 * Everything else a page set, its `default-src 'none'` and `frame-ancestors
 * 'none'` among them, is left as it was. Policies of pages that do not carry
 * the router (a frame's own page, with a nonce) are returned unchanged.
 */
export function policyForRouter(
  policy: string,
  contentBase: URL | null,
  avatarOrigin: string,
): string {
  const directives = directivesOf(policy)
  const script = directives.find(([name]) => name === 'script-src')?.[1]
  if (!script?.includes("'self'")) return policy
  const decks = contentBase
    ? [`${contentBase.protocol}//*.${contentBase.host}`]
    : []
  withSources(directives, 'connect-src', ["'self'"])
  withSources(directives, 'img-src', ["'self'", avatarOrigin, ...decks])
  withSources(directives, 'frame-src', ["'self'", ...decks])
  withSources(directives, 'form-action', [
    "'self'",
    'https://github.com',
    ...decks,
  ])
  return directives
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ')
}
