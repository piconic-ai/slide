import { eventRefOf, isEventAddress } from '../events/event-url'
import { gatherKeyOf } from './gather'

/** What the part of a path after `/link/` says, query included. */
export type LinkPath =
  | Readonly<{ kind: 'refused' }>
  | Readonly<{ kind: 'address'; url: string }>

/**
 * The page of links an address belongs to (F45).
 *
 * - `rest`: what follows `/link/` in the one path of the page: the address
 *   without its scheme. Every way of writing the address has the same `rest`
 *   (F45-AC31).
 * - `eventShaped`: whether it is an event of connpass, Doorkeeper or Luma.
 * - `eventKey`: the key to look an event up by first, or null when no event
 *   can have this address (F45-AC35): an event of another site is looked up
 *   only by an address without a query.
 * - `gatherKey`: the key to look the other links up by.
 */
export type LinkTarget = Readonly<{
  rest: string
  eventShaped: boolean
  eventKey: string | null
  gatherKey: string
}>

/** The longest address read, as a related link keeps it (F27). */
const MAX_LENGTH = 2000
const ENCODED = /^https?%3a/iu
const HTTP_SCHEME = /^https?:\/{0,2}/iu
const SCHEME = /^[a-z][a-z0-9+.-]*:/iu
// `example.com:8443/a` starts like a scheme but is a host and its port.
const HOST_AND_PORT = /^[^/?#@]*:\d{1,5}(?:[/?#]|$)/u
const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f]/u
// A host with an empty label (`.`, `a..b`) names no site.
const EMPTY_LABEL = /^\.|\.\./u
const REFUSED = { kind: 'refused' } as const

/** The text with its `%` forms read, or null when they cannot be read. */
function decoded(text: string): string | null {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

function parsed(address: string): URL | null {
  try {
    return new URL(address)
  } catch {
    return null
  }
}

/**
 * Reads what follows `/link/` (the raw path and query, as `new URL` gives
 * them, never decoded by the router) as an https address. The address may be
 * written with `https://`, `http://`, `https:/`, without a scheme, or wholly
 * `%`-encoded (F45-AC31). Any other scheme, a user name or password, an
 * address that cannot be read and one longer than a related link may be are
 * refused (F45-AC13). What follows `#` is left out (F45-AC32).
 */
export function parseLinkPath(rest: string): LinkPath {
  const text = ENCODED.test(rest) ? decoded(rest) : rest
  if (text === null || WHITESPACE_OR_CONTROL.test(text)) return REFUSED
  const address = text.replace(HTTP_SCHEME, '')
  if (SCHEME.test(address) && !HOST_AND_PORT.test(address)) return REFUSED
  const url = parsed(`https://${address}`)
  if (!url || url.username !== '' || url.password !== '') return REFUSED
  if (EMPTY_LABEL.test(url.hostname) || url.href.length > MAX_LENGTH)
    return REFUSED
  return { kind: 'address', url: url.href }
}

/** One step towards the key an address is gathered by. */
const keyOf = (href: string) =>
  isEventAddress(href) ? (eventRefOf(href)?.key ?? href) : gatherKeyOf(href)

/**
 * The key no further step changes. One step is not always enough: the
 * compared form of `a.b.connpass.com/event/07` is an event address whose key
 * drops the zero, and only one leading `www.` is dropped at a time. The steps
 * are bounded, so an address written to need more still ends.
 */
function settledKeyOf(href: string): string {
  let key = keyOf(href)
  for (let step = 0; step < 8; step += 1) {
    const next = keyOf(key)
    if (next === key) break
    key = next
  }
  return key
}

/** The page of links an https address belongs to. */
export function linkTargetOf(url: string): LinkTarget {
  const key = settledKeyOf(url)
  const eventShaped = isEventAddress(key)
  const queried = new URL(key).search !== ''
  return {
    rest: key.slice('https://'.length),
    eventShaped,
    eventKey: eventShaped || !queried ? (eventRefOf(key)?.key ?? null) : null,
    gatherKey: gatherKeyOf(key),
  }
}

/** The one path of the page of links an https address belongs to. */
export const linkPagePath = (url: string): string =>
  `/link/${linkTargetOf(url).rest}`
