import type { MiddlewareHandler } from 'hono'
import { renewedSessionCookies } from './owner-session'

/**
 * Puts a renewed session's cookie on the response, whichever way the route
 * built it (F28-AC103). Routes that return a Response of their own drop
 * headers set through the context, so this adds them after the route ran.
 */
export const carrySessionRenewal: MiddlewareHandler = async (c, next) => {
  await next()
  const cookies = renewedSessionCookies(c.req.raw)
  if (cookies.length === 0) return
  // A fetched Response has immutable headers; a copy can take the cookie.
  const response = new Response(c.res.body, c.res)
  for (const cookie of cookies) response.headers.append('Set-Cookie', cookie)
  // The cookie is this person's: no shared cache may keep the answer, even
  // one the route meant to be kept for a year (a versioned picture).
  // An HTML page keeps no-transform, so the edge still leaves its body alone.
  const keep = /\bno-transform\b/.test(
    response.headers.get('Cache-Control') ?? '',
  )
  response.headers.set(
    'Cache-Control',
    keep ? 'private, no-store, no-transform' : 'private, no-store',
  )
  // Clearing first stops Hono from copying the old cookies over the new ones.
  c.res = undefined
  c.res = response
}
