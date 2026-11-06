import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { exchangeCode, fetchUser } from './github-client'
import {
  authorizeUrl,
  codeChallenge,
  ownerDecision,
  parseOAuthStart,
  serializeOAuthStart,
} from './github-oauth'
import {
  currentOwner,
  endOwnerSession,
  randomToken,
  startOwnerSession,
} from './owner-session'

const OAUTH_COOKIE = '__Host-slide_oauth'
const OAUTH_SECONDS = 10 * 60

const auth = new Hono<{ Bindings: Env }>()

auth.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('Referrer-Policy', 'no-referrer')
  await next()
})

function oauthConfig(env: Env) {
  const clientId = env.GITHUB_APP_CLIENT_ID
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

// The callback must match the URL registered on the GitHub App exactly, so it
// comes from configuration rather than the request host.
const callbackUrl = (env: Env) =>
  new URL('/auth/github/callback', env.PUBLIC_ORIGIN).href

auth.get('/github', async (c) => {
  const config = oauthConfig(c.env)
  if (!config) return c.text('GitHub login is not configured', 503)
  const start = { state: randomToken(), verifier: randomToken() }
  setCookie(c, OAUTH_COOKIE, serializeOAuthStart(start), {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: OAUTH_SECONDS,
  })
  return c.redirect(
    authorizeUrl({
      clientId: config.clientId,
      redirectUri: callbackUrl(c.env),
      state: start.state,
      challenge: await codeChallenge(start.verifier),
    }),
  )
})

auth.get('/github/callback', async (c) => {
  const config = oauthConfig(c.env)
  if (!config) return c.text('GitHub login is not configured', 503)
  const start = parseOAuthStart(getCookie(c, OAUTH_COOKIE))
  deleteCookie(c, OAUTH_COOKIE, { path: '/', secure: true })
  const code = c.req.query('code')
  if (!start || !code || c.req.query('state') !== start.state)
    return c.text('GitHub login expired; start again', 400)
  const token = await exchangeCode({
    ...config,
    code,
    redirectUri: callbackUrl(c.env),
    verifier: start.verifier,
  })
  const user = token && (await fetchUser(token))
  if (!user) return c.text('GitHub login failed; start again', 502)
  const decision = ownerDecision(user, c.env.GITHUB_ACTOR_ID)
  if (!decision.ok) return c.text('This GitHub account is not allowed', 403)
  await startOwnerSession(c, decision)
  return c.redirect('/')
})

auth.post('/logout', csrf(), async (c) => {
  await endOwnerSession(c)
  return c.redirect('/', 303)
})

auth.get('/owner', async (c) => {
  const owner = await currentOwner(c)
  return owner ? c.json(owner) : c.json({ error: 'Not signed in' }, 401)
})

export { auth as authRoutes }
