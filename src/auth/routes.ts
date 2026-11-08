import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { z } from 'zod'
import { bindRepository } from '../decks/bind'
import { continuationSchema, createAuth, oauthConfig } from './config'
import { oauthIntentSchema } from './github-oauth'
import { revokeToken } from './github-client'
import { currentOwner, endOwnerSession, ownerSession } from './owner-session'

export { oauthConfig } from './config'
const auth = new Hono<{ Bindings: Env }>()
auth.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
})

export async function beginAuthorization<E extends { Bindings: Env }>(
  c: Context<E>,
  intent: z.input<typeof oauthIntentSchema>,
) {
  const original = intent.kind === 'bind' ? await ownerSession(c) : null
  if (intent.kind === 'bind' && !original)
    return c.text('Sign in as the owner', 401)
  const instance = createAuth(c.env, {
    continuation:
      intent.kind === 'bind' && original
        ? { ...intent, sessionId: original.id }
        : { kind: 'login' },
  })
  if (!instance) return c.text('GitHub login is not configured', 503)
  const response = await instance.api.signInSocial({
    body: { provider: 'github', callbackURL: '/decks', disableRedirect: true },
    headers: c.req.raw.headers,
    asResponse: true,
  })
  for (const cookie of response.headers.getSetCookie())
    c.header('Set-Cookie', cookie, { append: true })
  const parsed = z.object({ url: z.url() }).safeParse(await response.json())
  return parsed.success
    ? c.redirect(parsed.data.url, 303)
    : c.text('GitHub login failed; start again', 502)
}
auth.get('/github', (c) => beginAuthorization(c, { kind: 'login' }))
auth.get('/github/callback', async (c) => {
  const config = oauthConfig(c.env)
  if (!config) return c.text('GitHub login is not configured', 503)
  let token: string | undefined
  let completed: Response | undefined
  const instance = createAuth(c.env, {
    onToken: (value) => {
      token = value
    },
    async onIdentity(user, accessToken, state) {
      const parsed = continuationSchema.safeParse(state)
      if (!parsed.success) return false
      if (parsed.data.kind === 'login') return true
      const original = await ownerSession(c)
      if (
        !original ||
        original.id !== parsed.data.sessionId ||
        original.owner.userId !== String(user.id)
      ) {
        completed = c.text(
          'Sign in as the owner before connecting a repository',
          403,
        )
      } else
        completed = await bindRepository(
          c,
          parsed.data.request,
          original.owner,
          accessToken,
        )
      // A binding is authorization only. Returning no identity halts Better Auth before any account or session write.
      return false
    },
  })
  if (!instance) return c.text('GitHub login is not configured', 503)
  try {
    const url = new URL(c.req.url)
    url.pathname = '/auth/callback/github'
    const response = await instance.handler(new Request(url, c.req.raw))
    if (completed) {
      for (const cookie of response.headers.getSetCookie())
        completed.headers.append('Set-Cookie', cookie)
      return completed
    }
    return response
  } finally {
    if (token) await revokeToken(config, token)
  }
})
auth.get('/error', (c) =>
  c.text('GitHub login failed or expired; start again', 400),
)
auth.post('/logout', csrf(), async (c) => {
  await endOwnerSession(c)
  return c.redirect('/', 303)
})
auth.get('/owner', async (c) => {
  const owner = await currentOwner(c)
  return owner ? c.json(owner) : c.json({ error: 'Not signed in' }, 401)
})
export { auth as authRoutes }
