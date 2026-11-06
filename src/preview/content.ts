import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { SESSION_HARD_SECONDS } from './lifetime'
import { PREVIEW_COOKIE, privateHeaders, reopenPage } from './pages'
import { consumeLaunch } from './store'
import { decideAccess, requestedFile } from './access'
import { readAccessFacts, readDeployedFile, renewSession } from './access-store'
import { matchesIfNoneMatch, weakEtag } from './etag'
import { serveStoredFile, storedFileUrl } from './stored-file'

const now = () => Math.floor(Date.now() / 1000)
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

/**
 * Author files run as their own origin at the top level or in the viewer's
 * iframe. They get no forms, popups, or service workers, and only the
 * management origin may frame them.
 */
const contentPolicy = (frameAncestor: string) =>
  `sandbox allow-scripts allow-same-origin; worker-src 'none'; frame-ancestors ${frameAncestor}`

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
  app.use('*', async (c, next) => {
    await next()
    // Owner-only unless a handler chose a public policy.
    for (const [name, value] of Object.entries(privateHeaders))
      if (!c.res.headers.has(name)) c.header(name, value)
  })
  app.post('/_preview/launch', async (c) => {
    const form = await c.req.parseBody().catch(() => ({}))
    const token = tokenSchema.safeParse(
      'token' in form ? form.token : undefined,
    )
    const session =
      token.success &&
      (await consumeLaunch(c.env.DB, {
        token: token.data,
        deploymentId,
        allowedOwnerId: c.env.GITHUB_ACTOR_ID,
        now: now(),
      }))
    if (!session)
      return c.html(
        reopenPage(new URL('/decks', c.env.PUBLIC_ORIGIN).href),
        403,
      )
    setCookie(c, PREVIEW_COOKIE, session, {
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: SESSION_HARD_SECONDS,
    })
    // Replace the POST so a reload does not resend the used token.
    return c.redirect('/', 303)
  })
  app.get('*', async (c) => {
    const at = now()
    const path = requestedFile(c.req.path)
    const sessionToken = tokenSchema.safeParse(getCookie(c, PREVIEW_COOKIE))
    const facts = await readAccessFacts(c.env.DB, {
      deploymentId,
      sessionToken: sessionToken.success ? sessionToken.data : null,
      allowedOwnerId: c.env.GITHUB_ACTOR_ID,
      now: at,
    })
    // Authorization comes before any stored byte is read.
    const access = decideAccess(facts, at)
    if (access.kind === 'reopen')
      return c.html(
        reopenPage(new URL('/decks', c.env.PUBLIC_ORIGIN).href),
        401,
      )
    if (access.kind === 'not_found') return c.text('Not found', 404)
    if (access.kind === 'owner' && access.renewTo && facts.sessionHash)
      await renewSession(c.env.DB, facts.sessionHash, access.renewTo)
    const file = path && (await readDeployedFile(c.env.DB, deploymentId, path))
    if (!file) return c.text('Not found', 404)
    const fileHeaders = () => {
      c.header('Content-Type', file.mediaType)
      c.header(
        'Content-Security-Policy',
        contentPolicy(new URL(c.env.PUBLIC_ORIGIN).origin),
      )
    }
    if (access.kind === 'owner') {
      // Owner-only bytes never enter a shared cache.
      const object = await c.env.UPLOADS.get(file.objectKey)
      if (!object) return c.text('Not found', 404)
      fileHeaders()
      return c.body(object.body)
    }
    // Browsers revalidate every time, so a stop takes effect at once.
    c.header('Cache-Control', 'no-cache')
    c.header('ETag', weakEtag(file.sha256))
    if (matchesIfNoneMatch(c.req.header('If-None-Match'), file.sha256))
      return c.body(null, 304)
    const internal = new Request(storedFileUrl({ deploymentId, ...file }))
    const stored = cachedFiles
      ? await cachedFiles.fetch(internal)
      : await serveStoredFile(c.env.UPLOADS, internal)
    if (!stored.ok) return c.text('Not found', 404)
    fileHeaders()
    // Shows whether the bytes came from the internal cache, for operators.
    c.header('X-Content-Cache', stored.headers.get('Cf-Cache-Status') ?? 'none')
    // HEAD drops the body; release the internal one rather than leave it.
    if (c.req.method === 'HEAD') {
      await stored.body?.cancel()
      return c.body(null)
    }
    return c.body(stored.body ?? '')
  })
  app.all('*', (c) => c.text('Not found', 404))
  return app
}
