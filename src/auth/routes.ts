import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from './owner-middleware'
import { endOwnerSession, ownerSession } from './owner-session'
import { endSession } from './sessions-store'

const auth = new Hono<{ Bindings: Env }>()
auth.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
})

auth.post('/logout', csrf(), async (c) => {
  await endOwnerSession(c)
  return c.redirect('/', 303)
})
auth.post('/logout-device', csrf(), async (c) => {
  const session = await ownerSession(c)
  if (!session) return c.json({ error: 'Not signed in' }, 401)
  const form = await c.req.parseBody()
  const target = typeof form.session === 'string' ? form.session : ''
  // Only the person's own rows match; anything else ends nothing (F28-AC110).
  if (target) await endSession(c.env.DB, session.owner, target)
  return c.redirect('/settings?saved=signed-out-device#account', 303)
})
auth.get('/owner', async (c) => {
  const owner = await currentOwner(c)
  return owner ? c.json(owner) : c.json({ error: 'Not signed in' }, 401)
})
export { auth as authRoutes }
