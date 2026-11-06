import { Hono } from 'hono'
import { privateHeaders } from './pages'

/** Routes served on a deployment's own content origin. */
export function contentApp(_deploymentId: string) {
  const app = new Hono<{ Bindings: Env }>()
  app.use('*', async (c, next) => {
    await next()
    for (const [name, value] of Object.entries(privateHeaders))
      c.header(name, value)
  })
  app.all('*', (c) => c.text('Not found', 404))
  return app
}
