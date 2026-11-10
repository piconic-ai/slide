import { Hono } from 'hono'
import { authRoutes } from './src/auth/routes'
import { accountForms } from './src/decks/account-routes'
import { deckApi, deckForms } from './src/decks/routes'
import { publicationApi, publicationForms } from './src/publication/routes'
import { contentBaseOf } from './src/preview/config'
import { routeOfHost } from './src/preview/origin'
import { privateHeaders } from './src/preview/pages'
import { contentApp } from './src/preview/content'
import { previewForms } from './src/preview/routes'
import { sweepPreviews } from './src/preview/store'
import { deckUploadsApi, uploadsApi } from './src/uploads/api'
import { describeCleanupError, runUploadCleanup } from './src/uploads/cleanup'
import { purgeDelaySeconds, purgeDeletedDecks } from './src/decks/deletion'
import { parseUploadLimits } from './src/uploads/limits'
import { statusPage } from './src/uploads/status-page'
import {
  LEGAL_PAGE_POLICY,
  legalKinds,
  legalPage,
  legalPath,
} from './src/site/legal-pages'
import { shareRoutes } from './src/share/routes'
import { homeRoutes } from './src/site/home-routes'
import {
  noBodyRewrite,
  noindexPrivate,
  robotsTxt,
  siteHeaders,
} from './src/site/middleware'
import { rateLimit, withinLimit } from './src/site/rate-limit'
import { RETRY_AFTER_SECONDS } from './src/site/rate-limit-policy'
import { maintenance, notFound, onError } from './src/site/errors'
import {
  isMaintenance,
  MAINTENANCE_RETRY_AFTER_SECONDS,
} from './src/site/error-pages'

const app = new Hono<{ Bindings: Env }>()
app.use(siteHeaders, noindexPrivate, noBodyRewrite)
app.notFound(notFound)
app.onError(onError)
// Crawlers read a 5xx robots.txt as a full disallow, so it stays up.
app.get('/robots.txt', robotsTxt)
// The terms and the contact point stay readable during maintenance.
for (const kind of legalKinds)
  app.get(legalPath(kind), (c) =>
    c.html(legalPage(kind), 200, {
      'Content-Security-Policy': LEGAL_PAGE_POLICY,
    }),
  )
app.use(maintenance, rateLimit)
app.route('/api/uploads', uploadsApi)
app.route('/auth', authRoutes)
app.route('/account', accountForms)
app.route('/decks', deckForms)
app.route('/decks', previewForms)
app.route('/decks', publicationForms)
app.route('/api/decks', deckApi)
app.route('/api/decks', deckUploadsApi)
app.route('/api/decks', publicationApi)
app.route('/', shareRoutes)
app.route('/', homeRoutes)
app.get('/uploads/:id', (c) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  return c.html(statusPage)
})

/**
 * The service's own static files exist on the management host only. The
 * Worker runs before them, so a deployment origin serves the author's
 * `/styles.css`, not the service's.
 */
async function managementFetch(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
) {
  // The top page is a static file too, but the app serves it with the
  // page headers; see homeRoutes.
  const { pathname } = new URL(request.url)
  const isTop = pathname === '/'
  if (!isTop && (request.method === 'GET' || request.method === 'HEAD')) {
    // Browsers ask for /favicon.ico on pages without an icon link; the
    // service's icon is an SVG, sent under its own type.
    if (pathname === '/favicon.ico')
      request = new Request(new URL('/favicon.svg', request.url), request)
    // A failing lookup falls through, so the app's error handling answers.
    const asset = await env.ASSETS.fetch(request).catch(() => null)
    if (asset && asset.status !== 404) return asset
  }
  return app.fetch(request, env, ctx)
}

/**
 * A deployment origin's request, counted against the per-IP content budget
 * before authorization reads D1.
 */
async function contentFetch(
  deploymentId: string,
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
) {
  if (!(await withinLimit(env, 'content', request)))
    return new Response('Too many requests; retry later', {
      status: 429,
      headers: {
        ...privateHeaders,
        'Retry-After': String(RETRY_AFTER_SECONDS),
      },
    })
  return contentApp(deploymentId, ctx?.exports?.ContentFiles ?? null).fetch(
    request,
    env,
    ctx,
  )
}

/**
 * Requests on the content domain never reach the management app: a
 * deployment origin gets only its content routes, anything else 404.
 * Maintenance stops content delivery too, so nothing reads D1 meanwhile.
 */
function fetch(request: Request, env: Env, ctx?: ExecutionContext) {
  const route = routeOfHost(
    contentBaseOf(env),
    env.PUBLIC_ORIGIN,
    new URL(request.url),
  )
  if (route.kind !== 'management' && isMaintenance(env.MAINTENANCE))
    return new Response('Under maintenance', {
      status: 503,
      headers: {
        ...privateHeaders,
        'Retry-After': String(MAINTENANCE_RETRY_AFTER_SECONDS),
      },
    })
  switch (route.kind) {
    case 'management':
      return managementFetch(request, env, ctx)
    case 'deployment':
      return contentFetch(route.deploymentId, request, env, ctx)
    case 'content_other':
      return new Response('Not found', { status: 404, headers: privateHeaders })
  }
}

export default {
  fetch,
  scheduled(event, env, ctx) {
    // Sweeps write D1 and R2, so they wait while maintenance holds the data.
    if (isMaintenance(env.MAINTENANCE)) {
      console.log(JSON.stringify({ event: 'scheduled_skipped_maintenance' }))
      return
    }
    const at = Math.floor(event.scheduledTime / 1000)
    ctx.waitUntil(
      sweepPreviews(env.DB, at).catch((error: unknown) =>
        console.error(
          JSON.stringify({
            event: 'preview_sweep_error',
            name: error instanceof Error ? error.name : 'unknown',
          }),
        ),
      ),
    )
    ctx.waitUntil(
      runUploadCleanup(env, at).then(
        (summary) =>
          console.log(JSON.stringify({ event: 'upload_cleanup', ...summary })),
        (error: unknown) =>
          console.error(
            JSON.stringify({
              event: 'upload_cleanup_error',
              ...describeCleanupError(error),
            }),
          ),
      ),
    )
    ctx.waitUntil(
      Promise.resolve()
        .then(() =>
          purgeDeletedDecks(
            env,
            at,
            purgeDelaySeconds(parseUploadLimits(env.UPLOAD_LIMITS)),
          ),
        )
        .then(
          (summary) =>
            console.log(JSON.stringify({ event: 'deck_purge', ...summary })),
          (error: unknown) =>
            console.error(
              JSON.stringify({
                event: 'deck_purge_error',
                ...describeCleanupError(error),
              }),
            ),
        ),
    )
  },
} satisfies ExportedHandler<Env>
