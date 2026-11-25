/** The services an event can come from; `web` is any other site. */
export const EVENT_SERVICES = ['connpass', 'doorkeeper', 'luma', 'web'] as const
export type EventService = (typeof EVENT_SERVICES)[number]

/**
 * What a related link of the kind "event" points at, read from its address
 * alone (nothing is asked of the site).
 *
 * - `key`: one event has one key, however its address was written.
 * - `ref`: the event within its service: the number on connpass and
 *   Doorkeeper, the name on Luma, the host and path elsewhere.
 * - `host`: the host of the event itself: `connpass.com` for every connpass
 *   event, whatever group an address names; the address's host elsewhere.
 * - `linkHost`: the host this one address was written with (lower case). It
 *   belongs to the link, not to the event: two links of one connpass event
 *   may name two groups. A community matches the hosts of an event's links
 *   against its group's page.
 * - `url`: the address to lead readers to: https, without query, fragment or
 *   group, and with the number written without leading zeros.
 */
export type EventRef = Readonly<{
  key: string
  service: EventService
  ref: string
  host: string
  linkHost: string
  url: string
}>

/**
 * Words Luma uses for its own pages at the top of the path. An address with
 * one of them is a page of the site, not an event. Compared in lower case.
 */
export const LUMA_SITE_PATHS: ReadonlySet<string> = new Set([
  'about',
  'api',
  'calendar',
  'calendars',
  'create',
  'dashboard',
  'discover',
  'embed',
  'explore',
  'help',
  'home',
  'ics',
  'login',
  'logout',
  'pricing',
  'privacy',
  'settings',
  'signin',
  'signup',
  'terms',
  'u',
  'user',
])

const CONNPASS_EVENT = /^\/event\/(\d{1,32})\/?$/u
const DOORKEEPER_EVENT = /^\/events\/(\d{1,32})\/?$/u
const LUMA_EVENT = /^\/([A-Za-z0-9_-]{1,100})\/?$/u
// One label of a host name: what a group's subdomain may be.
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u

/** The host of an address in lower case, without a trailing dot. */
const hostOf = (url: URL) => url.host.toLowerCase().replace(/\.$/u, '')

/** The group of `<group>.<domain>`, or null when the host is not one. */
function groupOf(host: string, domain: string): string | null {
  if (!host.endsWith(`.${domain}`)) return null
  const group = host.slice(0, -domain.length - 1)
  return LABEL.test(group) ? group : null
}

const parse = (address: string): URL | null => {
  try {
    const url = new URL(address)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

/**
 * A number as digits without leading zeros (`0` stays `0`), or null when it
 * is longer than any event number.
 */
function numberOf(digits: string | undefined): string | null {
  if (digits === undefined) return null
  const number = digits.replace(/^0+(?=\d)/u, '')
  return number.length <= 18 ? number : null
}

/** The path with the slashes at its end made one, so `/event/1//` is `/event/1/`. */
const oneTrailingSlash = (path: string) => path.replace(/\/+$/u, '/')

/** The connpass event number of an address, with or without a group. */
function connpassNumber(host: string, path: string): string | null {
  if (host !== 'connpass.com' && groupOf(host, 'connpass.com') === null)
    return null
  return numberOf(CONNPASS_EVENT.exec(path)?.[1])
}

/** The Doorkeeper event number of `<group>.doorkeeper.jp/events/<n>`. */
function doorkeeperNumber(host: string, path: string): string | null {
  if (groupOf(host, 'doorkeeper.jp') === null) return null
  return numberOf(DOORKEEPER_EVENT.exec(path)?.[1])
}

/** The Luma event name of `luma.com/<name>` or `lu.ma/<name>`. */
function lumaName(host: string, path: string): string | null {
  if (host !== 'luma.com' && host !== 'lu.ma') return null
  const name = LUMA_EVENT.exec(path)?.[1]
  return name && !LUMA_SITE_PATHS.has(name.toLowerCase()) ? name : null
}

/**
 * Whether an address has the shape of an event page on connpass, Doorkeeper
 * or Luma: such a link is an event unless its author says otherwise.
 */
export function isEventAddress(address: string): boolean {
  const url = parse(address)
  if (!url) return false
  const host = hostOf(url)
  const path = oneTrailingSlash(url.pathname)
  return (
    connpassNumber(host, path) !== null ||
    doorkeeperNumber(host, path) !== null ||
    lumaName(host, path) !== null
  )
}

/** A path without the slashes at its end; the root is the empty path. */
const trimmed = (path: string) => path.replace(/\/+$/u, '')

/**
 * The event an address stands for, once its author made it an event. The
 * key is the address in https, with its host in lower case, without query,
 * fragment or trailing slashes, and with lu.ma written luma.com. Numbers lose
 * their leading zeros. A connpass event is its number, whatever group the
 * address names. Null for anything that is not an http(s) address.
 */
export function eventRefOf(address: string): EventRef | null {
  const url = parse(address)
  if (!url) return null
  const written = hostOf(url)
  const host = written === 'lu.ma' ? 'luma.com' : written
  // The service is told after the slashes at the end are made one, so an
  // address that ends in `//` is the same event as the one that ends in `/`.
  const path = oneTrailingSlash(url.pathname)
  const connpass = connpassNumber(written, path)
  if (connpass !== null)
    return {
      key: `https://connpass.com/event/${connpass}`,
      service: 'connpass',
      ref: connpass,
      host: 'connpass.com',
      linkHost: written,
      // The group is left out: the first author's group is not the event's.
      url: `https://connpass.com/event/${connpass}/`,
    }
  const doorkeeper = doorkeeperNumber(written, path)
  if (doorkeeper !== null)
    return {
      key: `https://${host}/events/${doorkeeper}`,
      service: 'doorkeeper',
      ref: doorkeeper,
      host,
      linkHost: host,
      url: `https://${host}/events/${doorkeeper}`,
    }
  const luma = lumaName(written, path)
  if (luma !== null)
    return {
      key: `https://luma.com/${luma}`,
      service: 'luma',
      ref: luma,
      host,
      linkHost: host,
      url: `https://luma.com/${luma}`,
    }
  return {
    key: `https://${host}${trimmed(path)}`,
    service: 'web',
    ref: `${host}${trimmed(path)}`,
    host,
    linkHost: host,
    url: `https://${host}${path}`,
  }
}

/**
 * The page of the group an event belongs to, which a community can take as
 * its link for slides (`https://<group>.connpass.com/`,
 * `https://<group>.doorkeeper.jp/`). Null for an event of no group: a
 * connpass address without one, Luma, and other sites.
 */
export function groupPageOf(
  event: Readonly<{ service: EventService; host: string }>,
): string | null {
  const domain =
    event.service === 'connpass'
      ? 'connpass.com'
      : event.service === 'doorkeeper'
        ? 'doorkeeper.jp'
        : null
  return domain !== null && groupOf(event.host, domain) !== null
    ? `https://${event.host}/`
    : null
}

/**
 * The one group the links of an event name, as its page: null when they name
 * none or more than one (a wrong or another group may have been written for
 * the same connpass number). Links that name no group are left out.
 */
export function groupPageOfHosts(
  service: EventService,
  hosts: Iterable<string>,
): string | null {
  const pages = new Set(
    [...hosts]
      .map((host) => groupPageOf({ service, host }))
      .filter((page) => page !== null),
  )
  return pages.size === 1 ? ([...pages][0] ?? null) : null
}
