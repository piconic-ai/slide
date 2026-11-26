// The one rule the load scripts keep before anything else: they never send a
// request to the production origins (D-142). Every address the scripts are
// given, and every address a response sends them to, goes through here first.
//
// The address is read with the same parser `fetch` uses, so what is judged is
// what would be contacted: upper case, a trailing dot, a port, `http`, a
// full-width or percent-encoded spelling, and any subdomain all come out as
// the host they name.

/** The domains of production; a host of these, or under them, is refused. */
export const PRODUCTION_DOMAINS = ['slide.community', 'slideusercontent.com']

/**
 * @typedef {{ ok: true, url: URL, local: boolean }
 *   | { ok: false, reason: string }} Checked
 */

/** The host without the dots that end a fully qualified name. */
const hostOf = (url) => url.hostname.replace(/\.+$/, '').toLowerCase()

const isProduction = (host) =>
  PRODUCTION_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  )

/** Whether the host is this machine: the only place a client address is faked. */
export function isLocalHost(host) {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127(\.\d{1,3}){3}$/.test(host)
  )
}

/**
 * Judges an address a script would contact. Any address is refused when it is
 * not an http or https address, carries a user name or password, or names
 * production.
 *
 * @param {unknown} input
 * @returns {Checked}
 */
export function checkAddress(input) {
  if (typeof input !== 'string' || input.trim() === '')
    return { ok: false, reason: 'The address is empty' }
  let url
  try {
    url = new URL(input.trim())
  } catch {
    return { ok: false, reason: 'The address is not a URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, reason: 'Only http and https addresses are used' }
  if (url.username !== '' || url.password !== '')
    return {
      ok: false,
      reason: 'An address with a user name or password is refused',
    }
  const host = hostOf(url)
  if (host === '') return { ok: false, reason: 'The address has no host' }
  if (isProduction(host))
    return {
      ok: false,
      reason: 'That is a production address; the load scripts never contact it',
    }
  return { ok: true, url, local: isLocalHost(host) }
}

/**
 * The origin to aim at: an address with nothing after the host and port.
 *
 * @param {unknown} input
 * @returns {Checked}
 */
export function checkOrigin(input) {
  const checked = checkAddress(input)
  if (!checked.ok) return checked
  const { url } = checked
  if (
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search !== '' ||
    url.hash !== ''
  )
    return {
      ok: false,
      reason: 'Give an origin, such as http://localhost:8787, without a path',
    }
  return checked
}

/** Thrown, before anything is sent, for an address the scripts must not contact. */
export class RefusedAddress extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason)
    this.name = 'RefusedAddress'
  }
}
