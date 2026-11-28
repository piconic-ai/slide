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
 *   can have this address (F45-AC35). An event of connpass, Doorkeeper or
 *   Luma is looked up without its query. An event of another site is looked
 *   up by the address as it was written (its `www.` stays, and the compared
 *   form of its site is not applied), and only when the address has no query.
 * - `eventRest`: what follows `/link/` in the path of the page of that event,
 *   or null when `eventKey` is. It is `rest` for connpass, Doorkeeper and
 *   Luma, and the written host and path for an event of another site.
 * - `gatherKey`: the key to look the other links up by.
 */
export type LinkTarget = Readonly<{
  rest: string
  eventShaped: boolean
  eventKey: string | null
  eventRest: string | null
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
 * The most steps the key of an address can need. A step that changes the key
 * either drops one leading `www.` (four characters of an address no longer
 * than MAX_LENGTH) or is one of the few that turn the compared form into the
 * key of an event, so this bound is never reached; it only shows that the
 * loop ends.
 */
const MAX_STEPS = MAX_LENGTH / 'www.'.length + 12

/**
 * The key no further step changes. One step is not always enough: the
 * compared form of `a.b.connpass.com/event/07` is an event address whose key
 * drops the zero, and only one leading `www.` is dropped at a time. The steps
 * go on until the key stays as it is, so the canonical form read again is
 * itself and one redirect is enough (F45-AC31).
 */
function settledKeyOf(href: string): string {
  let key = keyOf(href)
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const next = keyOf(key)
    if (next === key) break
    key = next
  }
  return key
}

const SCHEME_LENGTH = 'https://'.length

/**
 * The key of the event an address may be, and the `rest` of that event's
 * page. `key` is the settled key and `written` the address before any rule
 * compared it.
 */
function eventOf(
  key: string,
  written: string,
): Pick<LinkTarget, 'eventKey' | 'eventRest'> {
  // connpass, Doorkeeper and Luma: the settled key is the key of the event.
  if (isEventAddress(key)) {
    const eventKey = eventRefOf(key)?.key ?? null
    return { eventKey, eventRest: eventKey?.slice(SCHEME_LENGTH) ?? null }
  }
  // Another site: the event has the host and path as written. A query the
  // address was written with and the compared form keeps means no event has
  // this address. A name the compared form drops (a tracking name) does not
  // count, nor does one a site rule makes up (Vimeo's `h` from the path).
  const writtenNames = new URL(written).searchParams
  const queried = [...new URL(key).searchParams.keys()].some((name) =>
    writtenNames.has(name),
  )
  const eventKey = queried ? null : (eventRefOf(written)?.key ?? null)
  return { eventKey, eventRest: eventKey?.slice(SCHEME_LENGTH) ?? null }
}

/** The page of links an https address belongs to. */
export function linkTargetOf(url: string): LinkTarget {
  const key = settledKeyOf(url)
  return {
    rest: key.slice(SCHEME_LENGTH),
    eventShaped: isEventAddress(key),
    ...eventOf(key, url),
    gatherKey: gatherKeyOf(key),
  }
}

/**
 * The keys an event of the address may be kept under (F45-AC35): the one key
 * of the address as written, or none when the address has a query and so can
 * be no event. An event of another site is looked up with the `www.` it was
 * written with and no other way: `www.example.com/conf` and
 * `example.com/conf` are two events.
 */
export const eventKeysOf = (target: LinkTarget): readonly string[] =>
  target.eventKey === null ? [] : [target.eventKey]

/**
 * The one path of the page of links an https address belongs to: the page
 * links of any kind but "event" are gathered on.
 */
export const linkPagePath = (url: string): string =>
  `/link/${linkTargetOf(url).rest}`

/**
 * The path of the page of an event, from the event's own address
 * (`events.url`). An event of connpass, Doorkeeper or Luma has the canonical
 * path. An event of another site has its address as written, `www.` and all:
 * two events that differ only by what the compared form drops keep two pages.
 */
export function eventPagePath(eventUrl: string): string {
  const target = linkTargetOf(eventUrl)
  return `/link/${target.eventRest ?? target.rest}`
}
