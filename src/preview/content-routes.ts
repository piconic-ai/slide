import { type Context, Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { ownerSessionApplies } from './fetch-site'
import { z } from 'zod'
import { FRAME_SESSION_SECONDS } from './lifetime'
import {
  type FrameFailure,
  launchedFrame,
  launchedFramePolicy,
  PREVIEW_COOKIE,
  privateHeaders,
  reopenPage,
  unavailableFrame,
  unavailableFramePolicy,
} from './pages'
import { PAGE_SCRIPT_PATH, pageScript, scriptHashSource } from '../pages/script'
import { injectedValidator, injectIntoBytes } from '../pages/inject'
import { contentLangDetector, langOf } from '../site/lang'
import { randomToken } from '../auth/owner-session'
import { consumeLaunch } from './store'
import { versionOfflineRoutes } from '../offline/version-routes'
import { VERSION_WORKER_PATH } from '../offline/limits'
import { decideAccess, requestedFile } from './access'
import { readAccessFacts, readDeployedFile } from './access-store'
import { matchesIfNoneMatch, weakEtag } from './etag'
import { storedFileUrl, type StoredFileRef } from './stored-file'
import { serveStoredFile } from './stored-file-store'

const now = () => Math.floor(Date.now() / 1000)
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

/**
 * Author files run as their own origin at the top level or in a frame. They
 * get no forms, popups, or service workers of their own. Who may frame them
 * is told by `frameAncestor`; see frameAncestorOf. `workerSrc` names the one
 * worker they may register (see workerSrcOf): the service's, which keeps a
 * public version for offline reading and drops it when the service
 * withdraws it.
 */
const contentPolicy = (frameAncestor: string, workerSrc: string) =>
  `sandbox allow-scripts allow-same-origin; worker-src ${workerSrc}; frame-ancestors ${frameAncestor}`

/**
 * Author files reach the browser byte for byte. no-transform keeps the edge
 * from rewriting HTML (for example Replace insecure JavaScript libraries),
 * which would also make it drop the ETag that revalidation relies on.
 */
export const OWNER_FILE_CACHE = 'private, no-store, no-transform'
export const PUBLIC_FILE_CACHE = 'no-cache, no-transform'

/** The cached entrypoint holding stored bytes, from ctx.exports. */
export type CachedFiles = Readonly<{
  fetch(request: Request): Promise<Response>
}>

/**
 * Routes served on a deployment's own content origin. Public files are read
 * through `cachedFiles` after authorization; without it, as in tests that
 * pass no ExecutionContext, they are read from R2 directly.
 */
export function contentApp(
  deploymentId: string,
  cachedFiles: CachedFiles | null,
) {
  const app = new Hono<{ Bindings: Env }>()
  app.use(contentLangDetector)
  app.use('*', async (c, next) => {
    await next()
    // Owner-only unless a handler chose a public policy.
    for (const [name, value] of Object.entries(privateHeaders))
      if (!c.res.headers.has(name)) c.header(name, value)
  })
  app.post('/_preview/launch', async (c) => {
    // Only the viewer's frame opens slides as their author: the session is
    // a cookie for that frame alone.
    if (c.req.header('Sec-Fetch-Dest') !== 'iframe')
      return c.text('Not found', 404)
    const form = await c.req.parseBody().catch(() => ({}))
    const token = tokenSchema.safeParse(
      'token' in form ? form.token : undefined,
    )
    const session =
      token.success &&
      (await consumeLaunch(c.env.DB, {
        token: token.data,
        deploymentId,
        now: now(),
      }))
    if (!session)
      return c.html(
        reopenPage(new URL('/my/slides', c.env.PUBLIC_ORIGIN).href, langOf(c)),
        403,
      )
    setCookie(c, PREVIEW_COOKIE, session, {
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'None',
      partitioned: true,
      maxAge: FRAME_SESSION_SECONDS,
    })
    const page = /^[1-9][0-9]{0,3}$/.exec(c.req.query('page') ?? '')?.[0]
    const target = page ? `/#${page}` : '/'
    c.header(
      'Content-Security-Policy',
      launchedFramePolicy(new URL(c.env.PUBLIC_ORIGIN).origin),
    )
    return c.html(launchedFrame(target))
  })
  // The same for every reader and every version, and holds nothing private.
  app.get(PAGE_SCRIPT_PATH, (c) =>
    c.body(pageScript(viewerOrigin(c)), 200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    }),
  )
  versionOfflineRoutes(app)
  app.get('*', async (c) => {
    const at = now()
    const path = requestedFile(c.req.path)
    const sessionToken = tokenSchema.safeParse(getCookie(c, PREVIEW_COOKIE))
    // Another deployment's page gets no more than an anonymous reader.
    const ownSession =
      sessionToken.success &&
      ownerSessionApplies(c.req.header('Sec-Fetch-Site'))
    const facts = await readAccessFacts(c.env.DB, {
      deploymentId,
      sessionToken: ownSession ? sessionToken.data : null,
      now: at,
    })
    // Authorization comes before any stored byte is read.
    const access = decideAccess(facts, at)
    const failure =
      (access.kind === 'reopen' || access.kind === 'not_found') &&
      frameFailureOf(c, access.kind)
    if (failure)
      return frameUnavailable(c, failure, access.kind === 'reopen' ? 401 : 404)
    if (access.kind === 'reopen')
      return c.html(
        reopenPage(new URL('/my/slides', c.env.PUBLIC_ORIGIN).href, langOf(c)),
        401,
      )
    if (access.kind === 'not_found') return c.text('Not found', 404)
    const file = path && (await readDeployedFile(c.env.DB, deploymentId, path))
    if (!file) return c.text('Not found', 404)
    const headers = fileHeaders(
      file.mediaType,
      frameAncestorOf(access.kind, c.env.PUBLIC_ORIGIN),
      workerSrcOf(access.kind, new URL(c.req.url).origin),
    )
    const injection = isTopPage(path, file.mediaType)
      ? await pageInjection(c)
      : null
    return access.kind === 'owner'
      ? serveOwnerFile(c, file, headers, injection)
      : servePublicFile(
          c,
          { deploymentId, ...file },
          headers,
          cachedFiles,
          injection,
        )
  })
  app.all('*', (c) => c.text('Not found', 404))
  return app
}

/**
 * Why the viewer's own frame got no slides, or null for any other request.
 * The viewer's frame is the one move the session counts for that comes from
 * the slides' own page (see launchedFrame), so it is `same-origin`; a frame
 * of another site asking for the same slides gets the plain answer.
 */
function frameFailureOf(
  c: ContentContext,
  access: 'reopen' | 'not_found',
): FrameFailure | null {
  const own =
    c.req.header('Sec-Fetch-Dest') === 'iframe' &&
    c.req.header('Sec-Fetch-Site') === 'same-origin'
  if (!own) return null
  return access === 'reopen' ? 'expired' : 'unsupported'
}

/** The answer to a viewer's frame that cannot show its owner-only version. */
function frameUnavailable(
  c: ContentContext,
  reason: FrameFailure,
  status: 401 | 404,
) {
  const nonce = randomToken()
  const origin = new URL(c.env.PUBLIC_ORIGIN).origin
  c.header('Content-Security-Policy', unavailableFramePolicy(origin, nonce))
  return c.html(unavailableFrame(origin, nonce, reason), status)
}

type ContentContext = Context<{ Bindings: Env }>

/** The origin the page script tells, from the service's settings alone. */
const viewerOrigin = (c: ContentContext) => new URL(c.env.PUBLIC_ORIGIN).origin

/**
 * The page script that goes inline into a version's top page, and its hash,
 * which names it in the validator.
 */
type PageInjection = Readonly<{ script: string; hash: string }>

/**
 * Whether the file is the version's top page, the one the viewer frames
 * and whose fragment is the page on screen. Other HTML pages are served as
 * stored: a page they told would be taken for a page of the top one.
 */
const isTopPage = (path: string, mediaType: string) =>
  path === 'index.html' && /^text\/html\s*(;|$)/i.test(mediaType)

async function pageInjection(c: ContentContext): Promise<PageInjection> {
  const script = pageScript(viewerOrigin(c))
  return { script, hash: await scriptHashSource(script) }
}

/** The bytes to serve: the top page with the page script, else as stored. */
async function servedBody(
  body: ReadableStream,
  injection: PageInjection | null,
): Promise<ReadableStream | Uint8Array<ArrayBuffer>> {
  if (!injection) return body
  const stored = new Uint8Array(await new Response(body).arrayBuffer())
  return injectIntoBytes(stored, injection.script) ?? stored
}

type DeployedFile = Readonly<{
  objectKey: string
  mediaType: string
  sha256: string
}>

/**
 * Who may frame a served file. Owner-only files stay inside the management
 * origin. Public files may be framed anywhere: the page other sites embed
 * frames them, and a browser checks every ancestor of a frame, the site
 * around that page included. The policy's sandbox holds whoever frames
 * them.
 */
const frameAncestorOf = (access: 'owner' | 'public', publicOrigin: string) =>
  access === 'owner' ? new URL(publicOrigin).origin : '*'

/**
 * The only worker a file may register. Public files may register the
 * service's own (and no other path of the author's), the one that serves a
 * version stored for offline reading. A path-qualified source matches that
 * one file, which every browser checked in docs/dev/f37-offline-reading.md
 * enforces. The author's own preview registers none.
 */
const workerSrcOf = (access: 'owner' | 'public', versionOrigin: string) =>
  access === 'owner' ? "'none'" : `${versionOrigin}${VERSION_WORKER_PATH}`

/** Headers of a served author file, for whoever may read it. */
const fileHeaders = (
  mediaType: string,
  frameAncestor: string,
  workerSrc: string,
) => ({
  'Content-Type': mediaType,
  'Content-Security-Policy': contentPolicy(frameAncestor, workerSrc),
})

/** The policy among a file's headers, for an answer without the file. */
const policiesOf = (headers: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(headers).filter(([name]) =>
      name.startsWith('Content-Security-Policy'),
    ),
  )

/** Owner-only bytes, read straight from R2: they never enter a shared cache. */
async function serveOwnerFile(
  c: ContentContext,
  file: DeployedFile,
  headers: Record<string, string>,
  injection: PageInjection | null,
) {
  const object = await c.env.UPLOADS.get(file.objectKey)
  if (!object) return c.text('Not found', 404)
  return c.body(await servedBody(object.body, injection), 200, {
    ...headers,
    'Cache-Control': OWNER_FILE_CACHE,
    // For browsers that send no Fetch Metadata: no other origin may embed
    // an owner-only file.
    'Cross-Origin-Resource-Policy': 'same-origin',
  })
}

/**
 * Public bytes, through the internal cache. Browsers revalidate every time,
 * so a stop takes effect at once. The internal cache keeps the stored
 * bytes; the page script goes into the top page after it, and the
 * validator names the script too.
 */
async function servePublicFile(
  c: ContentContext,
  file: StoredFileRef,
  headers: Record<string, string>,
  cachedFiles: CachedFiles | null,
  injection: PageInjection | null,
) {
  const validator = injection
    ? injectedValidator(file.sha256, injection.hash)
    : file.sha256
  c.header('Cache-Control', PUBLIC_FILE_CACHE)
  c.header('ETag', weakEtag(validator))
  if (matchesIfNoneMatch(c.req.header('If-None-Match'), validator))
    // A browser applies this to the copy it kept, which may be older than
    // the policy.
    return c.body(null, 304, policiesOf(headers))
  const internal = new Request(storedFileUrl(file))
  const stored = cachedFiles
    ? await cachedFiles.fetch(internal)
    : await serveStoredFile(c.env.UPLOADS, internal)
  if (!stored.ok) return c.text('Not found', 404)
  // Shows whether the bytes came from the internal cache, for operators.
  c.header('X-Content-Cache', stored.headers.get('Cf-Cache-Status') ?? 'none')
  // HEAD drops the body; release the internal one rather than leave it.
  if (c.req.method === 'HEAD') {
    await stored.body?.cancel()
    return c.body(null, 200, headers)
  }
  if (!stored.body) return c.body('', 200, headers)
  return c.body(await servedBody(stored.body, injection), 200, headers)
}
