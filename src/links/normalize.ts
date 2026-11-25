import {
  SITE_RULES,
  TRACKING_QUERY,
  type ComparedPage,
  type SiteRule,
} from './url-rules'

const isUnder = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`)

/** The site rule that covers a host as it is compared, if any. */
export const siteOf = (host: string): SiteRule | undefined =>
  SITE_RULES.find((rule) =>
    rule.hosts.some((name) =>
      rule.subdomains ? isUnder(host, name) : host === name,
    ),
  )

/** The name of a raw `name=value` query part, as written. */
export const nameOf = (part: string) => part.split('=', 1)[0] ?? ''

/** A host name as it is compared: without a final dot and a leading `www.`. */
export const comparedHostOf = (hostname: string) =>
  hostname.replace(/\.$/u, '').replace(/^www\./u, '')

/** Whether a query name tells only where a reader came from (F27-AC60). */
export const isTrackingQuery = (name: string) =>
  TRACKING_QUERY.prefixes.some((prefix) => name.startsWith(prefix)) ||
  TRACKING_QUERY.names.some((one) => one === name)

/** The address taken apart by the common rules (F27-AC62〜F27-AC65). */
function commonPage(url: URL): ComparedPage {
  const host = comparedHostOf(url.hostname)
  const path = url.pathname.replace(/\/+$/u, '') || '/'
  const query = url.search
    .slice(1)
    .split('&')
    .filter((part) => part !== '')
  return { host, port: url.port, path, query }
}

/**
 * The form two related links are compared in: two addresses of the same page
 * have the same form, even when they are written differently. It is used only
 * to tell whether a slide has a link already, never shown nor followed.
 * `href` is an address as parseHttpsUrl keeps it. The common rules and the
 * rules of each site are in `url-rules.ts`.
 */
export function normalizedUrlOf(href: string): string {
  const common = commonPage(new URL(href))
  const site = siteOf(common.host)
  const dropped = [
    ...(site?.hrefDroppedQuery ?? []),
    ...(site?.comparedWithout ?? []),
  ]
  const kept = {
    ...common,
    query: common.query.filter((part) => {
      const name = nameOf(part)
      return !isTrackingQuery(name) && !dropped.includes(name)
    }),
  }
  const page = site ? site.page(kept) : kept
  // Sorted by name only: parts of one name keep the order they had (F27-AC66).
  const query = [...page.query].sort((a, b) => {
    const [x, y] = [nameOf(a), nameOf(b)]
    return x < y ? -1 : x > y ? 1 : 0
  })
  const port = page.port === '' ? '' : `:${page.port}`
  const search = query.length === 0 ? '' : `?${query.join('&')}`
  return `https://${page.host}${port}${page.path}${search}`
}
