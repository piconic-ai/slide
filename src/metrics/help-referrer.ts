/**
 * The help article a reader came from, as `<aim>/<slug>`, read from the
 * Referer of a request to the contact page; null when it came from anywhere
 * else (F40-AC13). Only a page of the service's own help counts, so the
 * origin must be the service's. The query, the fragment and everything but
 * the two path segments are dropped.
 */
export function helpArticleOfReferrer(
  header: string | null | undefined,
  publicOrigin: string,
): string | null {
  if (!header) return null
  let url: URL
  try {
    url = new URL(header)
  } catch {
    return null
  }
  if (url.origin !== new URL(publicOrigin).origin) return null
  const match = /^\/help\/([a-z0-9-]{1,40})\/([a-z0-9-]{1,60})\/?$/.exec(
    url.pathname,
  )
  return match ? `${match[1]}/${match[2]}` : null
}
