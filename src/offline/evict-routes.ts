import { Hono } from 'hono'
import { contentBaseOf } from '../preview/config'
import { mayAnswerEviction } from './fetch-metadata'
import { managementEvictPage, managementEvictPolicy } from './evict-pages'
import { MANAGEMENT_EVICT_PATH } from './limits'

/** The viewer's way to clear an older version it kept; see managementEvictPage. */
export const evictRoutes = new Hono<{
  Bindings: Env
  Variables: { framedBySelf?: boolean }
}>().get(MANAGEMENT_EVICT_PATH, (c) => {
  const base = contentBaseOf(c.env)
  // Only the viewer's frame of this site clears: a link to this page does nothing.
  const framed = mayAnswerEviction(
    {
      dest: c.req.header('Sec-Fetch-Dest'),
      site: c.req.header('Sec-Fetch-Site'),
    },
    ['same-origin', 'same-site'],
  )
  if (!base || !framed) return c.text('Not found', 404)
  c.header('Content-Security-Policy', managementEvictPolicy(base))
  c.header('Cache-Control', 'no-store')
  c.header('X-Robots-Tag', 'noindex')
  c.set('framedBySelf', true)
  return c.html(managementEvictPage(base.origin))
})
