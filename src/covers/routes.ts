import { Hono, type Context } from 'hono'
import { matchesIfNoneMatch, weakEtag } from '../preview/etag'
import { isPublicDeployment } from '../share/store'
import { takeCoverShot } from './serve-routes'
import { coverShotUrl, coverTag, parseCoverFile } from './shot'

/**
 * Readers revalidate every time, as for a deck's files, so a stopped or
 * replaced deck's cover is gone on the next request. The image itself is
 * kept behind this check, in the internal cache.
 */
const COVER_CACHE = 'no-cache'

export const coverRoutes = new Hono<{ Bindings: Env }>()

/**
 * The generated cover of a deployment anyone may see now. D1 is read on
 * every request, before the internal cache, so a stopped or replaced deck's
 * cover is no longer given out.
 */
coverRoutes.get('/covers/:file', async (c) => {
  const notFound = () => c.body(null, 404, { 'Cache-Control': 'no-store' })
  const deploymentId = parseCoverFile(c.req.param('file'))
  if (!deploymentId || !(await isPublicDeployment(c.env.DB, deploymentId)))
    return notFound()
  const headers = {
    'Content-Type': 'image/jpeg',
    'Cache-Control': COVER_CACHE,
    'X-Content-Type-Options': 'nosniff',
    ETag: weakEtag(coverTag(deploymentId)),
  }
  if (matchesIfNoneMatch(c.req.header('If-None-Match'), coverTag(deploymentId)))
    return c.body(null, 304, headers)
  // Asking whether a cover exists starts no browser.
  if (c.req.method === 'HEAD') return c.body(null, 200, headers)
  const internal = new Request(coverShotUrl(deploymentId))
  // Without the cached entrypoint, as in tests, the cover is taken each time.
  const cached = safeExports(c)?.CoverShots
  const shot = cached
    ? await cached.fetch(internal)
    : await takeCoverShot(c.env, internal)
  if (!shot.ok) {
    await shot.body?.cancel()
    return shot.status === 404
      ? notFound()
      : c.body(null, 503, { 'Cache-Control': 'no-store', 'Retry-After': '60' })
  }
  return c.body(shot.body ?? '', 200, {
    ...headers,
    // Shows whether the image came from the internal cache, for operators.
    'X-Content-Cache': shot.headers.get('Cf-Cache-Status') ?? 'none',
  })
})

/** Hono throws when a request has no execution context, as in tests. */
function safeExports(c: Context) {
  try {
    return (c.executionCtx as unknown as ExecutionContext).exports
  } catch {
    return undefined
  }
}
