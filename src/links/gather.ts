import { comparedUrlOf } from './normalize'

/**
 * The key related links are gathered by on one page (F45): the compared form
 * of the address without the query names that only say where a video starts
 * (`gatheredWithout` in `url-rules.ts`; F45-AC5, F45-AC23). Links of the kind
 * "event" are gathered by the key of their event instead
 * (`src/events/event-url.ts`). `href` is an address as parseHttpsUrl keeps it.
 */
export const gatherKeyOf = (href: string): string =>
  comparedUrlOf(href, (site) => site?.gatheredWithout ?? [])

/**
 * The host name an address was written with: lower case, without a final dot
 * and a port. A leading `www.` stays, since a community's link is matched
 * against it as written (F30-AC65).
 */
export const linkHostOf = (href: string): string =>
  new URL(href).hostname.replace(/\.$/u, '')
