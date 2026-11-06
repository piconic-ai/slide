import { Hono } from 'hono'
import { authRoutes } from './src/auth/routes'
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
import { statusPage } from './src/uploads/status-page'
import { noindexPrivate, robotsTxt, siteHeaders } from './src/site/middleware'
import { rateLimit } from './src/site/rate-limit'
import { maintenance, notFound, onError } from './src/site/errors'
import {
  isMaintenance,
  MAINTENANCE_RETRY_AFTER_SECONDS,
} from './src/site/error-pages'

const app = new Hono<{ Bindings: Env }>()
app.use(siteHeaders, noindexPrivate)
app.notFound(notFound)
app.onError(onError)
// Crawlers read a 5xx robots.txt as a full disallow, so it stays up.
app.get('/robots.txt', robotsTxt)
app.use(maintenance, rateLimit)
app.route('/api/uploads', uploadsApi)
app.route('/auth', authRoutes)
app.route('/decks', deckForms)
app.route('/decks', previewForms)
app.route('/decks', publicationForms)
app.route('/api/decks', deckApi)
app.route('/api/decks', deckUploadsApi)
app.route('/api/decks', publicationApi)
app.get('/', (c) => c.html(statusPage))
app.get('/uploads/:id', (c) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  return c.html(statusPage)
})

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
      return app.fetch(request, env, ctx)
    case 'deployment':
      return contentApp(route.deploymentId).fetch(request, env, ctx)
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
  },
} satisfies ExportedHandler<Env>
