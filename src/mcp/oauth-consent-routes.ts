import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { currentOwner } from '../auth/owner-middleware'
import { accountTitles, renderPage, signInPrompt } from '../decks/pages'
import { langOf } from '../site/lang'
import { withinLimit } from '../site/rate-limit'
import { RETRY_AFTER_SECONDS } from '../site/rate-limit-policy'
import {
  answerUrl,
  checkAuthorization,
  CODE_SECONDS,
  fieldsOf,
  hashToken,
  MAX_KEPT_QUERY_LENGTH,
  tokenOf,
  type AuthorizationRequest,
} from './authorization'
import {
  consentBody,
  consentFailedTitle,
  consentFailureBody,
  consentPolicy,
  consentTitle,
  type ConsentFailure,
} from './oauth-consent-pages'
import { AUTHORIZE_PATH, issuerOf, mcpResource } from './oauth-metadata'
import { insertCode, readClient } from './oauth-store'
import { GRANTED_SCOPES } from './scope'

type C = Context<{ Bindings: Env }>
type Fields = Readonly<Record<string, string | undefined>>

/** Holds an authorization request while its author signs in. */
export const KEPT_REQUEST_COOKIE = '__Host-slide_authorize'
const KEPT_SECONDS = 10 * 60
/** Where sign-in is started so that it lands back on the kept request. */
export const SIGN_IN_FOR_AGENT = '/login?to=agent'
const MAX_CLIENT_ID_LENGTH = 100

const now = () => Math.floor(Date.now() / 1000)

/**
 * The pages of the authorization server an author opens in a browser. They
 * alone act on the author's session cookie; the endpoints a client calls
 * itself are in oauth-routes.ts and read none.
 */
export const oauthConsentRoutes = new Hono<{ Bindings: Env }>()

const failed = (c: C, failure: ConsentFailure) =>
  renderPage(
    c,
    consentFailedTitle(langOf(c)),
    consentFailureBody(failure, langOf(c)),
    400,
    undefined,
    'narrow',
  )

async function decide(c: C, fields: Fields) {
  const id = fields.client_id ?? ''
  const client =
    id !== '' && id.length <= MAX_CLIENT_ID_LENGTH
      ? await readClient(c.env.DB, id)
      : null
  return checkAuthorization(fields, client, mcpResource(c.env.PUBLIC_ORIGIN))
}

const answer = (
  c: C,
  redirectUri: string,
  state: string | null,
  result: Parameters<typeof answerUrl>[1],
) =>
  c.redirect(
    answerUrl(redirectUri, result, state, issuerOf(c.env.PUBLIC_ORIGIN)),
    303,
  )

/** Keeps the checked request in a cookie and sends its author to sign in. */
function signInFirst(c: C, request: AuthorizationRequest) {
  const kept = new URLSearchParams(fieldsOf(request)).toString()
  if (kept.length > MAX_KEPT_QUERY_LENGTH) return failed(c, 'missing')
  setCookie(c, KEPT_REQUEST_COOKIE, kept, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: KEPT_SECONDS,
  })
  return c.redirect(SIGN_IN_FOR_AGENT, 303)
}

/** A request kept across a sign-in comes back as the address it had. */
function resumeKept(c: C) {
  const kept = getCookie(c, KEPT_REQUEST_COOKIE)
  deleteCookie(c, KEPT_REQUEST_COOKIE, { path: '/', secure: true })
  // Read as a query and spelled again, so whatever the cookie holds goes
  // into the address encoded.
  return kept
    ? c.redirect(`${AUTHORIZE_PATH}?${new URLSearchParams(kept)}`, 303)
    : failed(c, 'missing')
}

/**
 * Both pages read D1 for whoever asks, signed in or not, so they count
 * against the per-IP budget of sign-in before they do.
 */
oauthConsentRoutes.use(AUTHORIZE_PATH, async (c, next) => {
  if (await withinLimit(c.env, 'auth', c.req.raw)) return next()
  return c.text('Too many requests; retry later', 429, {
    'Retry-After': String(RETRY_AFTER_SECONDS),
    'Cache-Control': 'no-store',
  })
})

oauthConsentRoutes.get(AUTHORIZE_PATH, async (c) => {
  const fields = c.req.query()
  if (fields.client_id === undefined) return resumeKept(c)
  const decision = await decide(c, fields)
  if (decision.kind === 'untrusted') return failed(c, decision.reason)
  const owner = await currentOwner(c)
  if (!owner) return signInFirst(c, decision.request)
  const lang = langOf(c)
  return renderPage(
    c,
    consentTitle(lang),
    consentBody(decision.request, owner.login, lang),
    200,
    consentPolicy(decision.request.redirectUri),
    'narrow',
  )
})

/** The text fields of a posted form; an uploaded file is not one. */
async function formFields(c: C): Promise<Fields> {
  const body = await c.req.parseBody()
  return Object.fromEntries(
    Object.entries(body).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

oauthConsentRoutes.post(AUTHORIZE_PATH, csrf(), async (c) => {
  const fields = await formFields(c)
  // Nothing the page carried is trusted: the request is checked again.
  const decision = await decide(c, fields)
  if (decision.kind === 'untrusted') return failed(c, decision.reason)
  const { request } = decision
  const owner = await currentOwner(c)
  const lang = langOf(c)
  if (!owner)
    return renderPage(
      c,
      accountTitles(lang).signInTitle,
      signInPrompt(lang),
      401,
    )
  if (fields.decision !== 'allow')
    return answer(c, request.redirectUri, request.state, {
      error: 'access_denied',
    })
  const code = tokenOf(crypto.getRandomValues(new Uint8Array(32)))
  await insertCode(c.env.DB, {
    codeHash: await hashToken(code),
    clientId: request.clientId,
    ownerUserId: owner.userId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    // What the page listed; the request's own `scope` is not read.
    scopes: GRANTED_SCOPES,
    expiresAt: now() + CODE_SECONDS,
  })
  return answer(c, request.redirectUri, request.state, { code })
})
