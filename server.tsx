import { Hono } from 'hono'
import { uploadsApi } from './src/uploads/api'
import { statusPage } from './src/uploads/status-page'

const app = new Hono<{ Bindings: Env }>()
app.route('/api/uploads', uploadsApi)
app.get('/', (c) => c.html(statusPage))
app.get('/uploads/:id', (c) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  return c.html(statusPage)
})
export default app
