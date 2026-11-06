import type { Handler, MiddlewareHandler } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { isIndexablePath, ROBOTS_TXT } from './indexing'

/**
 * Baseline headers for every management response. Pages that need a stricter
 * policy, such as a Content-Security-Policy, still set it themselves.
 */
export const siteHeaders: MiddlewareHandler = secureHeaders({
  xFrameOptions: 'DENY',
})

export const noindexPrivate: MiddlewareHandler = async (c, next) => {
  await next()
  if (!isIndexablePath(c.req.path))
    c.res.headers.set('X-Robots-Tag', 'noindex, nofollow')
}

export const robotsTxt: Handler = (c) =>
  c.text(ROBOTS_TXT, 200, { 'Cache-Control': 'public, max-age=3600' })
