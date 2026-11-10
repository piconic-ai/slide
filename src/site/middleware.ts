import type { Handler, MiddlewareHandler } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { isIndexablePath, ROBOTS_TXT } from './indexing'
import { isHtml, withNoTransform } from './no-transform'

/**
 * Baseline headers for every management response. They overwrite any value a
 * handler set for the same header; Content-Security-Policy is not among them,
 * so each page keeps its own policy.
 */
export const siteHeaders: MiddlewareHandler = secureHeaders({
  xFrameOptions: 'DENY',
})

/**
 * Keeps Cloudflare from rewriting management HTML. The zone's Web Analytics
 * would inject a beacon that the page CSP blocks; the zone plan allows no
 * host exclusion. no-transform also stops edge compression, so it is set on
 * HTML only.
 */
export const noBodyRewrite: MiddlewareHandler = async (c, next) => {
  await next()
  if (isHtml(c.res.headers.get('Content-Type')))
    c.res.headers.set(
      'Cache-Control',
      withNoTransform(c.res.headers.get('Cache-Control')),
    )
}

/**
 * Only successful pages on indexable paths may be listed. A 304 counts as
 * the 200 it revalidates: caches copy its headers into the stored page.
 */
export const noindexPrivate: MiddlewareHandler = async (c, next) => {
  await next()
  const ok = c.res.status === 200 || c.res.status === 304
  if (!isIndexablePath(c.req.path) || !ok)
    if (!c.res.headers.has('X-Robots-Tag'))
      c.res.headers.set('X-Robots-Tag', 'noindex, nofollow')
}

export const robotsTxt: Handler = (c) =>
  c.text(ROBOTS_TXT, 200, { 'Cache-Control': 'public, max-age=3600' })
