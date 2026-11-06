import { Hono } from 'hono'
import { contentBaseOf } from '../preview/config'
import { deploymentOrigin } from '../preview/origin'
import { isSharePath, parseSharePath, sharePath } from './path'
import {
  UNAVAILABLE_POLICY,
  unavailablePage,
  viewerPage,
  viewerPolicy,
} from './pages'
import { readSharedDeployment } from './store'

export const shareRoutes = new Hono<{ Bindings: Env }>()

/**
 * Every path under `/@`, however spelled, is answered here: the viewer, a
 * redirect to the canonical spelling, or the one unavailable page.
 */
shareRoutes.get('*', async (c, next) => {
  const raw = new URL(c.req.url).pathname
  if (!isSharePath(raw)) return next()
  // Readers revalidate, so a stop or replacement shows on the next visit.
  c.header('Cache-Control', 'no-cache')
  const unavailable = () => {
    c.header('Content-Security-Policy', UNAVAILABLE_POLICY)
    c.header('X-Robots-Tag', 'noindex')
    return c.html(unavailablePage, 404)
  }
  const path = parseSharePath(raw)
  if (path.kind === 'redirect') return c.redirect(path.path, 301)
  const base = contentBaseOf(c.env)
  if (path.kind === 'invalid' || !base) return unavailable()
  // Read from D1 on every view: the pointer decides what readers see.
  const deploymentId = await readSharedDeployment(
    c.env.DB,
    path.handle,
    path.slug,
  )
  if (!deploymentId) return unavailable()
  const contentOrigin = deploymentOrigin(base, deploymentId)
  c.header('Content-Security-Policy', viewerPolicy(contentOrigin))
  return c.html(
    viewerPage({
      handle: path.handle,
      slug: path.slug,
      shareUrl: new URL(sharePath(path.handle, path.slug), c.env.PUBLIC_ORIGIN)
        .href,
      contentUrl: `${contentOrigin}/`,
    }),
  )
})
