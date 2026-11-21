import { Hono, type Context } from 'hono'
import { contentBaseOf } from '../preview/config'
import { matchesIfNoneMatch, weakEtag } from '../preview/etag'
import { coverUrl } from '../share/cover'
import { isPublicDeployment } from '../share/store'
import { takeCoverShot } from './serve-routes'
import {
  NO_STORE_HEADERS,
  parseCoverFile,
  parsePageFile,
  shotTag,
  shotUrl,
  type ShotTarget,
} from './shot'
import { readPageSource } from './store'

/**
 * Readers revalidate every time, as for a deck's files, so a stopped or
 * replaced deck's cover is gone on the next request. The image itself is
 * kept behind this check, in the internal cache.
 */
const COVER_CACHE = 'no-cache'

type CoverEnv = { Bindings: Env; Variables: { embeddableImage?: boolean } }
type CoverContext = Context<CoverEnv>

export const coverRoutes = new Hono<CoverEnv>()

const notFound = (c: CoverContext) => c.body(null, 404, NO_STORE_HEADERS)
const retryLater = (c: CoverContext, after = '60') =>
  c.body(null, 503, { ...NO_STORE_HEADERS, 'Retry-After': after })

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
  whenNotTaken: (retryAfter?: string) => Response | Promise<Response>,
) {
  const headers = readerHeaders(target)
  if (matchesIfNoneMatch(c.req.header('If-None-Match'), shotTag(target)))
    return c.body(null, 304, headers)
  // Asking whether an image exists starts no browser.
  if (c.req.method === 'HEAD') return c.body(null, 200, headers)
  const shot = await takeShot(c, target)
  if (!shot.ok) {
    await shot.body?.cancel()
    return shot.status === 404
      ? notFound(c)
      : whenNotTaken(shot.headers.get('Retry-After') ?? undefined)
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
  c.set('embeddableImage', true)
  return answerShot(c, target, (after) => retryLater(c, after))
})

/**
 * The image of one page of a deployment anyone may see now, for a deck that
 * pages by number. D1 is read on every request, as for the cover.
 */
coverRoutes.get('/covers/:deployment/:file', async (c) => {
  const target = parsePageFile(c.req.param('deployment'), c.req.param('file'))
  if (!target) return notFound(c)
  const [isPublic, source] = await Promise.all([
    isPublicDeployment(c.env.DB, target.deploymentId),
    readPageSource(c.env.DB, target.deploymentId),
  ])
  if (!isPublic || !source?.loadsPageScript) return notFound(c)
  c.set('embeddableImage', true)
  return answerShot(c, target, () =>
    coverInstead(c, target.deploymentId, source.coverPath),
  )
})

/**
 * The deck's cover, for a page the browser could not take. It is not the
 * page's image, so it carries no validator and nothing may keep it: the
 * next request tries the page again.
 */
async function coverInstead(
  c: CoverContext,
  deploymentId: string,
  coverPath: string | null,
) {
  if (coverPath !== null) {
    // The deck's own image is one of its files, served from its origin.
    const base = contentBaseOf(c.env)
    if (!base) return notFound(c)
    c.header('Cache-Control', 'no-store')
    return c.redirect(coverUrl(base, deploymentId, coverPath), 302)
  }
  const shot = await takeShot(c, { kind: 'cover', deploymentId })
  if (!shot.ok) {
    await shot.body?.cancel()
    return shot.status === 404
      ? notFound(c)
      : retryLater(c, shot.headers.get('Retry-After') ?? undefined)
  }
  return c.body(shot.body ?? '', 200, {
    ...NO_STORE_HEADERS,
    'Content-Type': 'image/jpeg',
    'X-Content-Type-Options': 'nosniff',
  })
}
