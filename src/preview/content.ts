import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { z } from 'zod'
import { SESSION_HARD_SECONDS } from './lifetime'
import { PREVIEW_COOKIE, privateHeaders, reopenPage } from './pages'
import { consumeLaunch } from './store'

const now = () => Math.floor(Date.now() / 1000)
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

/** Routes served on a deployment's own content origin. */
export function contentApp(deploymentId: string) {
  const app = new Hono<{ Bindings: Env }>()
  app.use('*', async (c, next) => {
    await next()
    for (const [name, value] of Object.entries(privateHeaders))
      c.header(name, value)
  })
  app.post('/_preview/launch', async (c) => {
    const form = await c.req.parseBody().catch(() => ({}))
    const token = tokenSchema.safeParse(
      'token' in form ? form.token : undefined,
    )
    const session =
      token.success &&
      (await consumeLaunch(c.env.DB, {
        token: token.data,
        deploymentId,
        allowedOwnerId: c.env.GITHUB_ACTOR_ID,
        now: now(),
      }))
    if (!session)
      return c.html(
        reopenPage(new URL('/decks', c.env.PUBLIC_ORIGIN).href),
        403,
      )
    setCookie(c, PREVIEW_COOKIE, session, {
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: SESSION_HARD_SECONDS,
    })
    // Replace the POST so a reload does not resend the used token.
    return c.redirect('/', 303)
  })
  app.all('*', (c) => c.text('Not found', 404))
  return app
}
