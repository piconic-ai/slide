import { Hono } from 'hono'
import { authRoutes } from './src/auth/routes'
import { deckApi, deckForms } from './src/decks/routes'
import { publicationApi } from './src/publication/routes'
import { deploymentOfUrl, parseContentBase } from './src/preview/origin'
import { contentApp } from './src/preview/content'
import { deckUploadsApi, uploadsApi } from './src/uploads/api'
import { describeCleanupError, runUploadCleanup } from './src/uploads/cleanup'
import { statusPage } from './src/uploads/status-page'

const app = new Hono<{ Bindings: Env }>()
app.route('/api/uploads', uploadsApi)
app.route('/auth', authRoutes)
app.route('/decks', deckForms)
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
 * Requests to a subdomain of the content origin never reach the management
 * app: a deployment origin gets only its content routes, anything else 404.
 */
function fetch(request: Request, env: Env, ctx?: ExecutionContext) {
  const base = parseContentBase(env.CONTENT_ORIGIN)
  const url = new URL(request.url)
  if (base && url.hostname.endsWith(`.${base.hostname}`)) {
    const deploymentId = deploymentOfUrl(base, url)
    return deploymentId
      ? contentApp(deploymentId).fetch(request, env, ctx)
      : new Response('Not found', { status: 404 })
  }
  return app.fetch(request, env, ctx)
}

export default {
  fetch,
  scheduled(event, env, ctx) {
    const at = Math.floor(event.scheduledTime / 1000)
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
