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
 * - `host`: the host the address was written with (lower case), which a
 *   community matches against its group's page.
 * - `url`: the address to lead readers to: https, without query or fragment.
 */
export type EventRef = Readonly<{
  key: string
  service: EventService
  ref: string
  host: string
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

const CONNPASS_EVENT = /^\/event\/(\d{1,18})\/?$/u
const DOORKEEPER_EVENT = /^\/events\/(\d{1,18})\/?$/u
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

/** The connpass event number of an address, with or without a group. */
function connpassNumber(host: string, path: string): string | null {
  if (host !== 'connpass.com' && groupOf(host, 'connpass.com') === null)
    return null
  return CONNPASS_EVENT.exec(path)?.[1] ?? null
}

/** The Doorkeeper event number of `<group>.doorkeeper.jp/events/<n>`. */
function doorkeeperNumber(host: string, path: string): string | null {
  if (groupOf(host, 'doorkeeper.jp') === null) return null
  return DOORKEEPER_EVENT.exec(path)?.[1] ?? null
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
  return (
    connpassNumber(host, url.pathname) !== null ||
    doorkeeperNumber(host, url.pathname) !== null ||
    lumaName(host, url.pathname) !== null
  )
}

/** A path without the slashes at its end; the root is the empty path. */
const trimmed = (path: string) => path.replace(/\/+$/u, '')

/**
 * The event an address stands for, once its author made it an event. The
 * key is the address in https, with its host in lower case, without query,
 * fragment or trailing slash, and with lu.ma written luma.com. A connpass
 * event is its number, whatever group the address names. Null for anything
 * that is not an http(s) address.
 */
export function eventRefOf(address: string): EventRef | null {
  const url = parse(address)
  if (!url) return null
  const written = hostOf(url)
  const host = written === 'lu.ma' ? 'luma.com' : written
  const path = url.pathname
  const leadTo = `https://${host}${path}`
  const connpass = connpassNumber(written, path)
  if (connpass !== null)
    return {
      key: `https://connpass.com/event/${connpass}`,
      service: 'connpass',
      ref: connpass,
      host: written,
      url: leadTo,
    }
  const doorkeeper = doorkeeperNumber(written, path)
  if (doorkeeper !== null)
    return {
      key: `https://${host}/events/${doorkeeper}`,
      service: 'doorkeeper',
      ref: doorkeeper,
      host,
      url: leadTo,
    }
  const luma = lumaName(written, path)
  if (luma !== null)
    return {
      key: `https://luma.com/${luma}`,
      service: 'luma',
      ref: luma,
      host,
      url: leadTo,
    }
  return {
    key: `https://${host}${trimmed(path)}`,
    service: 'web',
    ref: `${host}${trimmed(path)}`,
    host,
    url: leadTo,
  }
}
