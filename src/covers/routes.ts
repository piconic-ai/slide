import { Hono, type Context } from 'hono'
import { matchesIfNoneMatch, weakEtag } from '../preview/etag'
import { isPublicDeployment } from '../share/store'
import { takeCoverShot } from './serve-routes'
import {
  NO_STORE_HEADERS,
  parseCoverFile,
  shotTag,
  shotUrl,
  type ShotTarget,
} from './shot'

/**
 * Readers revalidate every time, as for a deck's files, so a stopped or
 * replaced deck's cover is gone on the next request. The image itself is
 * kept behind this check, in the internal cache.
 */
const COVER_CACHE = 'no-cache'

type CoverContext = Context<{ Bindings: Env }>

export const coverRoutes = new Hono<{ Bindings: Env }>()

const notFound = (c: CoverContext) => c.body(null, 404, NO_STORE_HEADERS)
const retryLater = (c: CoverContext) =>
  c.body(null, 503, { ...NO_STORE_HEADERS, 'Retry-After': '60' })

const readerHeaders = (target: ShotTarget) => ({
  'Content-Type': 'image/jpeg',
  'Cache-Control': COVER_CACHE,
  'X-Content-Type-Options': 'nosniff',
  ETag: weakEtag(shotTag(target)),
})

/** Hono throws when a request has no execution context, as in tests. */
function safeExports(c: Context) {
  try {
    return (c.executionCtx as unknown as ExecutionContext).exports
  } catch {
    return undefined
  }
}

/**
 * Asks the internal cache for an image. Requests for the same image share
 * one key, so the cache answers them with one run of the browser.
 */
function takeShot(c: CoverContext, target: ShotTarget) {
  const internal = new Request(shotUrl(target))
  // Without the cached entrypoint, as in tests, the image is taken each time.
  const cached = safeExports(c)?.CoverShots
  return cached ? cached.fetch(internal) : takeCoverShot(c.env, internal)
}

/**
 * The image of a target the caller has found public. `whenNotTaken` answers
 * when the browser gave no image.
 */
async function answerShot(
  c: CoverContext,
  target: ShotTarget,
  whenNotTaken: () => Response | Promise<Response>,
) {
  const headers = readerHeaders(target)
  if (matchesIfNoneMatch(c.req.header('If-None-Match'), shotTag(target)))
    return c.body(null, 304, headers)
  // Asking whether an image exists starts no browser.
  if (c.req.method === 'HEAD') return c.body(null, 200, headers)
  const shot = await takeShot(c, target)
  if (!shot.ok) {
    await shot.body?.cancel()
    return shot.status === 404 ? notFound(c) : whenNotTaken()
  }
  return c.body(shot.body ?? '', 200, {
    ...headers,
    // Shows whether the image came from the internal cache, for operators.
    'X-Content-Cache': shot.headers.get('Cf-Cache-Status') ?? 'none',
  })
}

/**
 * The generated cover of a deployment anyone may see now. D1 is read on
 * every request, before the internal cache, so a stopped or replaced deck's
 * cover is no longer given out.
 */
coverRoutes.get('/covers/:file', async (c) => {
  const target = parseCoverFile(c.req.param('file'))
  if (!target || !(await isPublicDeployment(c.env.DB, target.deploymentId)))
    return notFound(c)
  return answerShot(c, target, () => retryLater(c))
})
