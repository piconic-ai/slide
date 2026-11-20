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

/** Whether a path answers with something other than a page of the frame. */
export const isWholePagePath = (path: string) =>
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
  if (isWholePagePath(to.pathname)) return false
  // A page that is not a page of the frame (the consent screen, with the
  // narrow policy it keeps) is left by a page load, whatever the link.
  if (isWholePagePath(from.pathname)) return false
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
 * runs under the old page's policy. A page that carries the router therefore
 * also allows what a viewer needs, which is the one thing the router cannot
 * otherwise bring in: a frame for the slides of the deck the viewer is about,
 * whose origin the page moved from does not know. That is the origin of any
 * deck, as a wildcard of the delivery domain; the top page already allows it
 * for pictures, and the pictures of the covers need it too. Nothing else is
 * added: `form-action`, `default-src`, `script-src`, `style-src`,
 * `base-uri` and `frame-ancestors` stay as each page set them. A move into a
 * page that needs more than the page it comes from has (a form, from a page
 * that allows none) is a page load; see `policyCovers`. Policies of pages
 * without `script-src 'self'` (a frame's own page, with a nonce) are
 * returned unchanged.
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
  return directives
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ')
}

/** Whether a source of the page moved to is allowed by one of the page moved from. */
const covers = (allowed: readonly string[], source: string) =>
  allowed.some((one) => {
    if (one === source) return true
    // A wildcard host covers the hosts under it.
    const wildcard = /^(\w+:)\/\/\*\.(.+)$/.exec(one)
    const host = /^(\w+:)\/\/([^/]+)/.exec(source)
    return (
      wildcard !== null &&
      host !== null &&
      host[1] === wildcard[1] &&
      host[2]?.endsWith(`.${wildcard[2]}`) === true
    )
  })

/** Directives that take what the page asks for from `default-src` when absent. */
const FALLS_BACK = new Set(['img-src', 'frame-src', 'connect-src', 'style-src'])

/** Directives no page asks anything of, whatever another page names. */
const NOT_ASKED = new Set(['default-src', 'base-uri', 'frame-ancestors'])

/** The sources a policy gives a directive, as the browser would answer for it. */
const allowedBy = (policy: [string, string[]][], name: string) => {
  const own = policy.find(([key]) => key === name)?.[1]
  if (own || !FALLS_BACK.has(name)) return own
  return policy.find(([key]) => key === 'default-src')?.[1]
}

/** Whether what a policy gives a directive allows the sources asked of it. */
const allows = (
  allowed: readonly string[] | undefined,
  name: string,
  sources: readonly string[],
) => {
  const asked = sources.filter((source) => source !== "'none'")
  if (asked.length === 0) return true
  // No form-action at all allows every form; no other directive is open.
  if (allowed === undefined) return name === 'form-action'
  return asked.every((source) => covers(allowed, source))
}

/**
 * Whether a page whose policy is `current` may bring in the page whose
 * policy is `incoming` without a page load: every source the incoming page
 * names is allowed by the current one, as the current policy would answer
 * for it. `form-action` counts only when the page has a form, since it is
 * the one directive that no `default-src` stands in for, and a page without
 * a form asks nothing of it.
 */
export function policyCovers(
  current: string,
  incoming: string,
  hasForm: boolean,
): boolean {
  const have = directivesOf(current)
  return directivesOf(incoming)
    .filter(([name]) => !NOT_ASKED.has(name))
    .filter(([name]) => hasForm || name !== 'form-action')
    .every(([name, sources]) => allows(allowedBy(have, name), name, sources))
}

/** Whether the region of a page, as the server wrote it, holds a form. */
export const regionHasForm = (html: string) =>
  /<form[\s>]/.test(/<main bf-region[\s\S]*?<\/main>/.exec(html)?.[0] ?? '')
