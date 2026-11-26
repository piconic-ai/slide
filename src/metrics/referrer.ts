/**
 * The hosts that belong to the service itself. A move between them is not a
 * visit from another place, so it is counted as one thing, `internal`
 * (D-73).
 */
export type OwnHosts = Readonly<{
  /** Hosts of the service: the management and the operator origins. */
  hosts: readonly string[]
  /** A host and every subdomain of it: the origin deployments are served on. */
  families: readonly string[]
}>

/** What the referrer column holds when the reader came from nowhere known. */
export const NO_REFERRER = ''
/** What it holds for a move within the service. */
export const INTERNAL_REFERRER = 'internal'

const HOST_NAME =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

const hostOf = (origin: string): string | null => {
  try {
    return new URL(origin).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** The own hosts that the origins in the settings name; an unreadable one is left out. */
export function ownHostsOf(
  origins: Readonly<{
    publicOrigin: string | undefined
    operatorOrigin: string | undefined
    contentOrigin: string | undefined
  }>,
): OwnHosts {
  const present = (hosts: (string | null)[]) =>
    hosts.filter((host): host is string => host !== null)
  const { publicOrigin, operatorOrigin, contentOrigin } = origins
  return {
    hosts: present([
      publicOrigin ? hostOf(publicOrigin) : null,
      operatorOrigin ? hostOf(operatorOrigin) : null,
    ]),
    families: present([contentOrigin ? hostOf(contentOrigin) : null]),
  }
}

const isOwn = (host: string, own: OwnHosts) =>
  own.hosts.includes(host) ||
  own.families.some((family) => host === family || host.endsWith(`.${family}`))

/**
 * What the Referer header leaves of where a reader came from: the host name
 * and nothing else (D-73). The path, the query, the port, the user name and
 * the password are dropped. A move within the service is `internal`. A
 * missing, unreadable or non-web referrer, and a referrer that names a
 * machine by its IP address, leave nothing (D-71: an IP address is never
 * kept).
 */
export function referrerOf(
  header: string | null | undefined,
  own: OwnHosts,
): string {
  if (!header) return NO_REFERRER
  let url: URL
  try {
    url = new URL(header)
  } catch {
    return NO_REFERRER
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return NO_REFERRER
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host.length > 253 || IPV4.test(host) || !HOST_NAME.test(host))
    return NO_REFERRER
  return isOwn(host, own) ? INTERNAL_REFERRER : host
}
