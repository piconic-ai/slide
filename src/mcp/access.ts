import { MCP_SCOPE, RESOURCE_METADATA_PATH } from './oauth-metadata'

// The longest token the server issues is far shorter; nothing longer is hashed.
const BEARER = /^Bearer ([A-Za-z0-9._~+/-]{1,512}=*)$/

/** The token of an `Authorization: Bearer` header, or null. */
export const bearerOf = (authorization: string | undefined): string | null =>
  BEARER.exec(authorization ?? '')?.[1] ?? null

/**
 * Whether a request's `Origin` may call the MCP endpoint. The endpoint acts
 * on a bearer token alone, so a page of another site has no authority to
 * borrow; even so it is not served to web pages, which the specification
 * asks servers to check. A request without the header, or from an app with
 * a scheme of its own, is not a web page.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  publicOrigin: string,
): boolean {
  if (origin === undefined) return true
  if (origin === new URL(publicOrigin).origin) return true
  return !/^https?:/i.test(origin) && origin !== 'null'
}

/**
 * The `WWW-Authenticate` challenge of a 401: where the protected resource
 * metadata is, and the scope to ask for (RFC 9728, RFC 6750). `rejected`
 * says a token was sent and is no good.
 */
export function challengeOf(publicOrigin: string, rejected: boolean): string {
  const metadata = new URL(RESOURCE_METADATA_PATH, publicOrigin).href
  const parts = [
    ...(rejected ? ['error="invalid_token"'] : []),
    `resource_metadata="${metadata}"`,
    `scope="${MCP_SCOPE}"`,
  ]
  return `Bearer ${parts.join(', ')}`
}
