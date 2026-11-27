import { Hono, type Context } from 'hono'
import { recordFrom } from '../metrics/record-routes'
import { ERROR_PAGE_POLICY, errorPage } from '../site/error-pages'
import { langOf } from '../site/lang'
import { linkPagePath, parseLinkPath } from './link-address'

type C = Context<{ Bindings: Env }>

const PREFIX = '/link/'

/**
 * What the footer's language switch reopens. Under `/link/` the query is
 * the link's own, `lang` included (F45-AC33), so the switch goes through
 * `/link?to=<path>&lang=…`, which keeps the choice and comes back
 * (F45-AC34). Without a page to come back to, it is `/link` alone.
 */
const switchUrlOf = (c: C, rest: string | null) =>
  new URL(
    rest === null ? '/link' : `/link?to=${encodeURIComponent(PREFIX + rest)}`,
    c.req.url,
  )

/** A 404 counts as an error page shown by this route (F40-AC14). */
const countNotFound = (c: C) =>
  recordFrom(c, {
    name: 'screen_error',
    kind: 'not_found',
    screen: c.req.routePath,
  })

/**
 * The answer to what cannot be read as an https address (F45-AC13): the
 * common 404. What was written is in no text and no href of it, the footer
 * included.
 */
function refused(c: C) {
  countNotFound(c)
  return c.html(errorPage('not_found', langOf(c), switchUrlOf(c, null)), 404, {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': ERROR_PAGE_POLICY,
  })
}

/** The pages of links, open to everyone (F45). */
export const linkPageRoutes = new Hono<{ Bindings: Env }>()

/**
 * Where the footer's language switch of a page of links lands (F45-AC34).
 * The language middleware has kept `?lang=`; this sends the reader back.
 * `to` is read as a page of links and answered with its one path, which
 * starts `/link/<host>`: nothing else, so no other site, is led to.
 * Registered before `/link/*`, which would also match `/link`.
 */
linkPageRoutes.get('/link', (c) => {
  const to = c.req.query('to') ?? ''
  const read = to.startsWith(PREFIX)
    ? parseLinkPath(to.slice(PREFIX.length))
    : null
  if (!read || read.kind === 'refused') return refused(c)
  return c.redirect(linkPagePath(read.url), 302)
})
