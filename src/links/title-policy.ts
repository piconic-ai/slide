/** How many redirects are followed on the way to a page. */
export const MAX_REDIRECTS = 3

const INTERNAL_SUFFIXES = ['.local', '.internal', '.localhost'] as const

/** A host name the service must not send a request to. */
function isInternalHost(host: string): boolean {
  // A trailing dot names the same host.
  const name = host.replace(/\.$/u, '').toLowerCase()
  if (name.startsWith('[')) return true // an IPv6 literal
  // The URL parser writes every IPv4 form (decimal, octal, hex) as dotted decimal.
  if (/^\d+\.\d+\.\d+\.\d+$/u.test(name)) return true
  if (name === 'localhost') return true
  if (INTERNAL_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true
  // A name with no dot is a name on some private network.
  return !name.includes('.')
}

/** Whether `host` is `own` or one of its subdomains. */
const isOwnHost = (host: string, own: string) =>
  host === own || host.endsWith(`.${own}`)

/**
 * The address a request may be sent to, or null. The service sends a request
 * only to a public https: address on the standard port with no user name:
 * never an IP address, `localhost`, a name that ends in `.local`, `.internal`
 * or `.localhost`, and never the service itself or its own content domain
 * (`ownHosts`, host names), so that a link cannot make the service ask for
 * its own pages. The link is kept either way; only the request is not made.
 */
export function fetchTarget(
  address: string,
  ownHosts: readonly string[],
): URL | null {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  // The standard port is written as none.
  if (url.port !== '') return null
  const host = url.hostname.toLowerCase()
  if (host === '' || isInternalHost(host)) return null
  const bare = host.replace(/\.$/u, '')
  if (ownHosts.some((own) => isOwnHost(bare, own.toLowerCase()))) return null
  return url
}

/** Whether a status is a redirect that names where to go next. */
export const isRedirectStatus = (status: number) =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308
