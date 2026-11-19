import { isRegisteredRedirect } from './client-registration'

export const CODE_SECONDS = 60
export const MAX_STATE_LENGTH = 512
/** The largest authorization request kept in a cookie across a sign-in. */
export const MAX_KEPT_QUERY_LENGTH = 3000
// RFC 7636: an S256 challenge is 43 to 128 base64url characters.
const CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/

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

/** An error the client is told through its redirect URI (RFC 6749, 4.1.2.1). */
export type RedirectedError =
  | 'invalid_request'
  | 'unsupported_response_type'
  | 'invalid_target'
  | 'access_denied'

export type AuthorizationDecision =
  | Readonly<{ kind: 'ok'; request: AuthorizationRequest }>
  /** Nowhere trustworthy to send an answer: the author is told instead. */
  | Readonly<{ kind: 'untrusted'; reason: 'unknown_client' | 'redirect_uri' }>
  | Readonly<{
      kind: 'refused'
      redirectUri: string
      state: string | null
      error: RedirectedError
    }>

type Fields = Readonly<Record<string, string | undefined>>

function refusalOf(fields: Fields, resource: string): RedirectedError | null {
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
  const tooLong = (fields.state ?? '').length > MAX_STATE_LENGTH
  const state = tooLong ? null : (fields.state ?? null)
  const error = tooLong ? 'invalid_request' : refusalOf(fields, resource)
  if (error) return { kind: 'refused', redirectUri, state, error }
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
