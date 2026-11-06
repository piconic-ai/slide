import { Hono } from 'hono'
import { authRoutes } from './src/auth/routes'
import { deckApi, deckForms } from './src/decks/routes'
import { publicationApi } from './src/publication/routes'
import { parseContentBase, routeOfHost } from './src/preview/origin'
import { privateHeaders } from './src/preview/pages'
import { contentApp } from './src/preview/content'
import { previewForms } from './src/preview/routes'
import { sweepPreviews } from './src/preview/store'
import { deckUploadsApi, uploadsApi } from './src/uploads/api'
import { describeCleanupError, runUploadCleanup } from './src/uploads/cleanup'
import { statusPage } from './src/uploads/status-page'

const app = new Hono<{ Bindings: Env }>()
app.route('/api/uploads', uploadsApi)
app.route('/auth', authRoutes)
app.route('/decks', deckForms)
app.route('/decks', previewForms)
app.route('/api/decks', deckApi)
app.route('/api/decks', deckUploadsApi)
app.route('/api/decks', publicationApi)
app.get('/', (c) => c.html(statusPage))
app.get('/uploads/:id', (c) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  return c.html(statusPage)
})
function contentBase(env: Env): URL | null {
  try {
    return parseContentBase(env.CONTENT_ORIGIN, env.PUBLIC_ORIGIN)
  } catch (error) {
    // A broken setting disables content delivery, not the management app.
    console.error(
      JSON.stringify({
        event: 'content_origin_invalid',
        message: error instanceof Error ? error.message : 'unknown',
      }),
    )
    return null
  }
}

/**
 * Requests on the content domain never reach the management app: a
 * deployment origin gets only its content routes, anything else 404.
 */
function fetch(request: Request, env: Env, ctx?: ExecutionContext) {
  const route = routeOfHost(
    contentBase(env),
    env.PUBLIC_ORIGIN,
    new URL(request.url),
  )
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
