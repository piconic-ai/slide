import { comparedHostOf, isTrackingQuery, nameOf, siteOf } from './normalize'

/**
 * The address a link leads to and is shown as, for the safety of the reader
 * who follows it (F27-AC59〜F27-AC61, F26-AC100): the tracking parts of the
 * query and the parts a site leaves out of its addresses (Luma's invitation
 * token `tk`, Medium's `source`) are taken out. The lists are the data of
 * `url-rules.ts`, shared with the compared form (`normalize.ts`).
 *
 * `href` is an `https:` or `http:` address as the URL parser writes it, so
 * every character a reader cannot see is already in its `%` form (F27-AC52)
 * and a host is in its ASCII form (one holding a direction character is
 * refused, or written as punycode by Markdown). Nothing else changes:
 * the other parts keep their order, values and spelling, and the path, the
 * port and the fragment stay as typed. An address with nothing to take out
 * comes back as it is.
 *
 * The migrations that build this form for the links already kept repeat the
 * rule in SQL; a change here needs a migration that builds it again.
 */
export function sanitizedUrlOf(href: string): string {
  const hash = href.indexOf('#')
  const fragment = hash === -1 ? '' : href.slice(hash)
  const address = hash === -1 ? href : href.slice(0, hash)
  const mark = address.indexOf('?')
  if (mark === -1) return href
  const parts = address.slice(mark + 1).split('&')
  const site = siteOf(comparedHostOf(new URL(href).hostname))
  const dropped = site?.hrefDroppedQuery ?? []
  const kept = parts.filter((part) => {
    const name = nameOf(part)
    return !isTrackingQuery(name) && !dropped.includes(name)
  })
  if (kept.length === parts.length) return href
  const query = kept.join('&')
  return `${address.slice(0, mark)}${query === '' ? '' : `?${query}`}${fragment}`
}
