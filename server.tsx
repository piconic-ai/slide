import { Hono } from 'hono'
import { uploadsApi } from './src/uploads/api'
import { describeCleanupError, runUploadCleanup } from './src/uploads/cleanup'
import { statusPage } from './src/uploads/status-page'

const app = new Hono<{ Bindings: Env }>()
app.route('/api/uploads', uploadsApi)
app.get('/', (c) => c.html(statusPage))
app.get('/uploads/:id', (c) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  return c.html(statusPage)
})
export default {
  fetch: app.fetch,
  scheduled(event, env, ctx) {
    ctx.waitUntil(
      runUploadCleanup(env, Math.floor(event.scheduledTime / 1000)).then(
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
