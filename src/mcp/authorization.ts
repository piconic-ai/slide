import { isRegisteredRedirect } from './client-registration'

export const CODE_SECONDS = 60
export const ACCESS_TOKEN_SECONDS = 60 * 60
export const REFRESH_TOKEN_SECONDS = 90 * 24 * 60 * 60
export const MAX_STATE_LENGTH = 512
/** The largest authorization request kept in a cookie across a sign-in. */
export const MAX_KEPT_QUERY_LENGTH = 3000
export const ACCESS_TOKEN_PREFIX = 'slide_at_'
export const REFRESH_TOKEN_PREFIX = 'slide_rt_'

// RFC 7636: 43 to 128 characters; a challenge is base64url, a verifier may
// also use `.`, `_`, `~`.
const CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

/** A token of `bytes` random bytes, as the text a client is given. */
export const tokenOf = (bytes: Uint8Array) => base64Url(bytes)

/**
 * How a token or code is stored: its SHA-256 alone. They are 256 random
 * bits, so nothing slower is needed, and the text itself is never kept.
 */
export async function hashToken(token: string): Promise<string> {
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
    ),
  )
}

const REFRESH_TOKEN = new RegExp(
  `^${REFRESH_TOKEN_PREFIX}([0-9a-f-]{36})\\.[A-Za-z0-9_-]{43}$`,
)

/**
 * A refresh token for a grant: the grant's ID, then the secret part. The ID
 * lets a token that was replaced long ago still name its grant, which is
 * then ended; the ID alone opens nothing.
 */
export const refreshTokenOf = (grantId: string, secret: Uint8Array) =>
  `${REFRESH_TOKEN_PREFIX}${grantId}.${tokenOf(secret)}`

/** The ID of the grant a refresh token names, or null when it is not one. */
export const grantIdOf = (refreshToken: string): string | null =>
  REFRESH_TOKEN.exec(refreshToken)?.[1] ?? null

/** Whether the verifier is the one whose S256 challenge was sent before. */
export async function verifiesChallenge(
  verifier: string,
  challenge: string,
): Promise<boolean> {
  return VERIFIER.test(verifier) && (await hashToken(verifier)) === challenge
}

/** A client as an authorization request needs it. */
type KnownClient = Readonly<{
  id: string
  name: string
  redirectUris: readonly string[]
}>

export type AuthorizationRequest = Readonly<{
  clientId: string
  clientName: string
  redirectUri: string
  codeChallenge: string
  state: string | null
}>

/** What is wrong with a request whose client and redirect URI are known. */
export type RequestError =
  | 'invalid_request'
  | 'unsupported_response_type'
  | 'invalid_target'
/** An error the client is told through its redirect URI (RFC 6749, 4.1.2.1). */
export type RedirectedError = 'access_denied'

export type AuthorizationDecision =
  | Readonly<{ kind: 'ok'; request: AuthorizationRequest }>
  /**
   * Nothing is sent anywhere: the author is told on a page of the service.
   * Anyone may register a client with any redirect URI, so answering a
   * malformed request by redirecting would make the service forward
   * whoever opens a link to a site of the sender's choosing (RFC 9700,
   * 4.11.2). Only an answer the author gives goes to the redirect URI.
   */
  | Readonly<{
      kind: 'untrusted'
      reason: 'unknown_client' | 'redirect_uri' | RequestError
    }>

type Fields = Readonly<Record<string, string | undefined>>

function refusalOf(fields: Fields, resource: string): RequestError | null {
  if (fields.response_type !== 'code') return 'unsupported_response_type'
  if (
    fields.code_challenge_method !== 'S256' ||
    !CHALLENGE.test(fields.code_challenge ?? '')
  )
    return 'invalid_request'
  // A token is good for this server alone, so no other resource is granted.
  if (fields.resource !== undefined && fields.resource !== resource)
    return 'invalid_target'
  return null
}

/**
 * Checks an authorization request against the client that sent it. `client`
 * is the registered client its `client_id` names, or null; `resource` is
 * the MCP server's identifier. The same check reads the request when the
 * page is shown and again when the author answers, so nothing the page
 * carried is trusted.
 */
export function checkAuthorization(
  fields: Fields,
  client: KnownClient | null,
  resource: string,
): AuthorizationDecision {
  if (!client) return { kind: 'untrusted', reason: 'unknown_client' }
  const redirectUri = fields.redirect_uri
  if (
    redirectUri === undefined ||
    !isRegisteredRedirect(redirectUri, client.redirectUris)
  )
    return { kind: 'untrusted', reason: 'redirect_uri' }
  const reason =
    (fields.state ?? '').length > MAX_STATE_LENGTH
      ? 'invalid_request'
      : refusalOf(fields, resource)
  if (reason) return { kind: 'untrusted', reason }
  const state = fields.state ?? null
  return {
    kind: 'ok',
    request: {
      clientId: client.id,
      clientName: client.name,
      redirectUri,
      codeChallenge: fields.code_challenge ?? '',
      state,
    },
  }
}

/** The fields of a checked request, to carry it through a form or a cookie. */
export const fieldsOf = (request: AuthorizationRequest) => ({
  response_type: 'code',
  client_id: request.clientId,
  redirect_uri: request.redirectUri,
  code_challenge: request.codeChallenge,
  code_challenge_method: 'S256',
  ...(request.state === null ? {} : { state: request.state }),
})

/**
 * The client's redirect URI with the answer added. `iss` names this server,
 * so a client talking to several can tell whose answer it is (RFC 9207).
 */
export function answerUrl(
  redirectUri: string,
  answer: Readonly<{ code: string } | { error: RedirectedError }>,
  state: string | null,
  issuer: string,
): string {
  const url = new URL(redirectUri)
  for (const [name, value] of Object.entries(answer))
    url.searchParams.set(name, value)
  if (state !== null) url.searchParams.set('state', state)
  url.searchParams.set('iss', issuer)
  return url.href
}

export type TokenRequest =
  | Readonly<{
      grant: 'authorization_code'
      code: string
      clientId: string
      redirectUri: string
      codeVerifier: string
    }>
  | Readonly<{ grant: 'refresh_token'; refreshToken: string; clientId: string }>
/** Why the token endpoint refuses, as RFC 6749 5.2 names it. */
export type TokenError =
  | 'invalid_request'
  | 'invalid_grant'
  | 'invalid_target'
  | 'unsupported_grant_type'
export type TokenRequestResult =
  | Readonly<{ ok: true; request: TokenRequest }>
  | Readonly<{ ok: false; error: TokenError }>

const present = (...values: readonly (string | undefined)[]) =>
  values.every((value) => value !== undefined && value !== '')

/** Reads the form a client posts to the token endpoint. */
export function parseTokenRequest(
  form: Fields,
  resource: string,
): TokenRequestResult {
  if (form.resource !== undefined && form.resource !== resource)
    return { ok: false, error: 'invalid_target' }
  const { grant_type, client_id = '' } = form
  if (grant_type === 'authorization_code') {
    const { code = '', redirect_uri = '', code_verifier = '' } = form
    return present(code, client_id, redirect_uri, code_verifier)
      ? {
          ok: true,
          request: {
            grant: grant_type,
            code,
            clientId: client_id,
            redirectUri: redirect_uri,
            codeVerifier: code_verifier,
          },
        }
      : { ok: false, error: 'invalid_request' }
  }
  if (grant_type === 'refresh_token') {
    const { refresh_token = '' } = form
    return present(refresh_token, client_id)
      ? {
          ok: true,
          request: {
            grant: grant_type,
            refreshToken: refresh_token,
            clientId: client_id,
          },
        }
      : { ok: false, error: 'invalid_request' }
  }
  return {
    ok: false,
    error:
      grant_type === undefined ? 'invalid_request' : 'unsupported_grant_type',
  }
}
