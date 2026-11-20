import type { Handler, MiddlewareHandler } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { AVATAR_ORIGIN } from '../profile/github-profile'
import { contentBaseOf } from '../preview/config'
import { isIndexablePath, ROBOTS_TXT } from './indexing'
import { isHtml, withNoTransform } from './no-transform'
import { policyForRouter } from './router-policy'

/**
 * Baseline headers for every management response. They overwrite any value a
 * handler set for the same header; Content-Security-Policy is not among them,
 * so each page keeps its own policy.
 */
const secure = secureHeaders({ xFrameOptions: 'DENY' })

/**
 * Baseline security headers. No page may be framed, except the one a handler
 * marks with `framedBySelf`, which only this origin may frame, and the one
 * marked with `framedByAnyone`: the page made for other sites to frame,
 * whose own policy says so.
 */
export const siteHeaders: MiddlewareHandler = async (c, next) => {
  await secure(c, next)
  if (c.get('framedBySelf') === true)
    c.res.headers.set('X-Frame-Options', 'SAMEORIGIN')
  if (c.get('framedByAnyone') === true) c.res.headers.delete('X-Frame-Options')
}

/**
 * Keeps Cloudflare from rewriting management HTML. The zone's Web Analytics
 * would inject a beacon that the page CSP blocks; the zone plan allows no
 * host exclusion. no-transform also stops edge compression, so it is set on
 * HTML only.
 */
export const noBodyRewrite: MiddlewareHandler = async (c, next) => {
  await next()
  // A 304 may omit Content-Type, yet browsers copy its headers into the
  // stored HTML page, so it gets the same directive.
  if (c.res.status === 304 || isHtml(c.res.headers.get('Content-Type')))
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

/**
 * Widens the policy of every page that carries the router, so that a page
 * the router moves in runs under what it needs; see policyForRouter. Each
 * page still sets its own policy; this only adds to it.
 */
export const routerPolicy: MiddlewareHandler = async (c, next) => {
  await next()
  // A page made to be framed (the embed) carries no router, and its policy
  // is what keeps a frame of slides from loading the service.
  if (c.get('framedBySelf') === true || c.get('framedByAnyone') === true) return
  const policy = c.res.headers.get('Content-Security-Policy')
  if (!policy || !isHtml(c.res.headers.get('Content-Type'))) return
  c.res.headers.set(
    'Content-Security-Policy',
    policyForRouter(policy, contentBaseOf(c.env), AVATAR_ORIGIN),
  )
}
