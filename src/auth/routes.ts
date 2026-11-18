import { Hono, type Context } from 'hono'
import { csrf } from 'hono/csrf'
import { z } from 'zod'
import { bindRepository } from '../decks/bind'
import { continuationSchema, createAuth, oauthConfig } from './config'
import { oauthIntentSchema } from './github-oauth'
import { fetchHasSponsorsListing, revokeToken } from './github-client'
import { isHandleTaken } from './handle-store'
import {
  hadNoAccount,
  recordJoinNotifications,
} from './join-notification-routes'
import { activeOwnerSession, currentOwner } from './owner-middleware'
import { endOwnerSession } from './owner-session'
import { handleOfLogin } from '../share/handle'
import { OWNER_COOKIE } from './config'
import {
  refusalPage,
  refusalPath,
  signInRefusals,
  type SignInRefusal,
} from './pages'
import { ERROR_PAGE_POLICY } from '../site/error-pages'
import { langOf } from '../site/lang'
import { profileOfGitHub, type Profile } from '../profile/github-profile'
import { saveProfile } from '../profile/store'
import { landingOf } from './landing'

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
  landing: ReturnType<typeof landingOf> = '/slides',
) {
  const original = intent.kind === 'bind' ? await activeOwnerSession(c) : null
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
    body: { provider: 'github', callbackURL: landing, disableRedirect: true },
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
auth.get('/github', (c) =>
  beginAuthorization(c, { kind: 'login' }, landingOf(c.req.query('to'))),
)
const startsSession = (response: Response) =>
  response.headers
    .getSetCookie()
    .some((cookie) => new RegExp(`^${OWNER_COOKIE}=[^;]`).test(cookie))

type SignedInProfile = {
  userId: string
  profile: Profile
  hasSponsors: boolean | null
  tokenForJoinCheck: string | null
}

async function afterSignIn(
  database: D1Database,
  { userId, profile, hasSponsors, tokenForJoinCheck }: SignedInProfile,
) {
  const now = Math.floor(Date.now() / 1000)
  await saveProfile(database, userId, profile, hasSponsors, now).catch(
    (error) => console.error('Profile sync failed', error),
  )
  if (tokenForJoinCheck)
    await recordJoinNotifications(
      database,
      userId,
      profile.login,
      tokenForJoinCheck,
      now,
    )
}

auth.get('/github/callback', async (c) => {
  const config = oauthConfig(c.env)
  if (!config) return c.text('GitHub login is not configured', 503)
  let token: string | undefined
  let completed: Response | undefined
  let refused: SignInRefusal | undefined
  // The author's GitHub profile, read while the token still works and
  // saved once the sign-in has given them a session.
  let synced: SignedInProfile | undefined
  const instance = createAuth(c.env, {
    onToken: (value) => {
      token = value
    },
    onRefused: (reason) => {
      refused = reason
    },
    async onIdentity(user, accessToken, state, profile) {
      const parsed = continuationSchema.safeParse(state)
      if (!parsed.success) return false
      if (parsed.data.kind === 'login') {
        // Signing in without a handle would leave them with no share URL
        // and no word why.
        const handle = handleOfLogin(user.login)
        const userId = String(user.id)
        if (handle && (await isHandleTaken(c.env.DB, userId, handle))) {
          refused = 'handle_taken'
          return false
        }
        synced = {
          userId,
          profile: profileOfGitHub(user.login, profile),
          tokenForJoinCheck: (await hadNoAccount(c.env.DB, userId))
            ? accessToken
            : null,
          hasSponsors: await fetchHasSponsorsListing(accessToken),
        }
        return true
      }
      // A connection started before a suspension must not finish after it.
      const original = await activeOwnerSession(c)
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
          parsed.data.sessionId,
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
    // Nothing was written for them; say why instead of a bare failure.
    if (refused) completed = c.redirect(refusalPath(refused), 303)
    if (completed) {
      for (const cookie of response.headers.getSetCookie())
        completed.headers.append('Set-Cookie', cookie)
      return completed
    }
    if (synced && startsSession(response)) await afterSignIn(c.env.DB, synced)
    return response
  } finally {
    if (token) await revokeToken(config, token)
  }
})
for (const reason of signInRefusals)
  auth.get(refusalPath(reason).replace('/auth', ''), (c) =>
    c.html(refusalPage(reason, langOf(c), new URL(c.req.url)), 200, {
      'Content-Security-Policy': ERROR_PAGE_POLICY,
    }),
  )
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
