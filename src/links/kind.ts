import { KIND_HOSTS } from './kind-hosts'
import type { LinkKind } from './link'

/** Whether `host` is `domain` or one of its subdomains. */
const isUnder = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`)

/**
 * The kind a link has, read from its address alone (nothing is asked of the
 * site): a video, an article, or other. A host written in another script is
 * its ASCII form (punycode) here, which no listed name matches, so a
 * look-alike of a listed site is "other". Anything that is not an address is
 * "other".
 */
export function kindOfUrl(address: string): LinkKind {
  let host: string
  try {
    host = new URL(address).hostname.toLowerCase().replace(/\.$/u, '')
  } catch {
    return 'other'
  }
  for (const kind of ['video', 'article'] as const)
    if (KIND_HOSTS[kind].some((domain) => isUnder(host, domain))) return kind
  return 'other'
}
