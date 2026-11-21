import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { currentOwner } from './owner-middleware'
import { endOwnerSession } from './owner-session'

const auth = new Hono<{ Bindings: Env }>()
auth.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
})

// The GitHub sign-in is gone; old links and bookmarks go to the login page,
// keeping the destination they asked for.
const legacyLogin = (c: {
  req: { url: string }
  redirect: (to: string, status: 303) => Response
}) => {
  const query = new URL(c.req.url).searchParams
  const kept = new URLSearchParams()
  for (const key of ['to', 'drop']) {
    const value = query.get(key)
    if (value) kept.set(key, value)
  }
  const text = kept.toString()
  return c.redirect(`/login${text ? `?${text}` : ''}`, 303)
}
auth.get('/github', legacyLogin)
auth.get('/github/callback', legacyLogin)
auth.get('/invitation-only', legacyLogin)
auth.get('/handle-taken', legacyLogin)
auth.post('/logout', csrf(), async (c) => {
  await endOwnerSession(c)
  return c.redirect('/', 303)
})
auth.get('/owner', async (c) => {
  const owner = await currentOwner(c)
  return owner ? c.json(owner) : c.json({ error: 'Not signed in' }, 401)
})
export { auth as authRoutes }
