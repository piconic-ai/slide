import { getCookie } from 'hono/cookie'
import type { MiddlewareHandler } from 'hono'
import { OWNER_COOKIE } from './config'
import { signInState } from './owner-session'
import { loginQuery } from './login-pages'

/**
 * Pages a person with no handle yet may still open: the ways to finish
 * signing in or out, the machine endpoints, and the pages every visitor reads.
 */
const OPEN = [
  '/welcome',
  '/login',
  '/auth/',
  '/api/',
  '/oauth/',
  '/.well-known/',
  '/mcp',
  '/covers/',
  '/oembed',
  '/robots.txt',
]
const isOpen = (path: string) =>
  OPEN.some((prefix) => path === prefix || path.startsWith(prefix))

/** The destination the welcome page should return to, as `landingOf` reads it. */
export const returnToOf = (path: string): string =>
  path === '/' ? 'top' : path === '/settings' ? 'settings' : path

/**
 * Until a first sign-in has chosen a handle and a name, every page leads
 * back to the welcome page (F28-AC4). Only a request that carries the
 * sign-in cookie pays for the check.
 */
export const welcomeFirst: MiddlewareHandler<{ Bindings: Env }> = async (
  c,
  next,
) => {
  if (
    (c.req.method === 'GET' || c.req.method === 'HEAD') &&
    !isOpen(c.req.path) &&
    getCookie(c, OWNER_COOKIE) !== undefined &&
    (await signInState(c)).kind === 'needs_welcome'
  )
    return c.redirect(
      `/welcome${loginQuery({ to: returnToOf(c.req.path) })}`,
      303,
    )
  return next()
}
