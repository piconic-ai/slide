import { z } from 'zod'

export const MAX_REDIRECT_URIS = 5
export const MAX_REDIRECT_URI_LENGTH = 2000
export const MAX_CLIENT_NAME_LENGTH = 100
/** The largest registration request read; the rest of one is ignored. */
export const MAX_REGISTRATION_BYTES = 16 * 1024

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Whether a URL names this machine: where a native client listens. */
export const isLoopback = (url: URL) => LOOPBACK_HOSTS.has(url.hostname)

/**
 * A redirect URI a client may register: HTTPS, or HTTP on a loopback host,
 * with no fragment and no credentials (MCP authorization, "Communication
 * Security"). Null when it is anything else.
 */
export function parseRedirectUri(value: string): URL | null {
  if (value.length > MAX_REDIRECT_URI_LENGTH || value.includes('#')) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  if (url.protocol === 'https:') return url
  return url.protocol === 'http:' && isLoopback(url) ? url : null
}

/**
 * Whether the redirect URI of a request is one the client registered. The
 * strings must be the same, except that a loopback URI may name another
 * port: a native client listens on whichever port is free (OAuth 2.1,
 * 8.4.2).
 */
export function isRegisteredRedirect(
  requested: string,
  registered: readonly string[],
): boolean {
  if (registered.includes(requested)) return true
  const url = parseRedirectUri(requested)
  if (!url || !isLoopback(url)) return false
  return registered.some((candidate) => {
    const known = parseRedirectUri(candidate)
    if (!known || !isLoopback(known)) return false
    known.port = url.port
    return known.href === url.href
  })
}

// A name is shown to the author, so nothing invisible may hide in it.
const NAME = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u

const requestSchema = z.object({
  client_name: z.unknown().optional(),
  redirect_uris: z.array(z.string()).min(1).max(MAX_REDIRECT_URIS),
})

export type ClientRegistration = Readonly<{
  name: string
  redirectUris: readonly string[]
}>
/** Why a registration is refused, as RFC 7591 names it. */
export type RegistrationError =
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata'
export type RegistrationResult =
  | Readonly<{ ok: true; client: ClientRegistration }>
  | Readonly<{ ok: false; error: RegistrationError; description: string }>

const refuse = (
  error: RegistrationError,
  description: string,
): RegistrationResult => ({ ok: false, error, description })

function nameOf(input: unknown, first: URL): string | null {
  if (input === undefined) return first.host
  if (typeof input !== 'string') return null
  const name = input.trim()
  return name.length > 0 &&
    name.length <= MAX_CLIENT_NAME_LENGTH &&
    NAME.test(name)
    ? name
    : null
}

/**
 * Reads a Dynamic Client Registration request (RFC 7591). Only the name and
 * the redirect URIs are read: every client is a public one that uses the
 * authorization code grant with PKCE, whatever else it asks for.
 */
export function parseClientRegistration(input: unknown): RegistrationResult {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success)
    return refuse(
      'invalid_redirect_uri',
      `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} URIs`,
    )
  const urls = parsed.data.redirect_uris.map(parseRedirectUri)
  const [first] = urls
  if (!first || urls.includes(null))
    return refuse(
      'invalid_redirect_uri',
      'Each redirect URI must be https, or http on localhost, without a fragment',
    )
  const name = nameOf(parsed.data.client_name, first)
  if (name === null)
    return refuse(
      'invalid_client_metadata',
      `client_name must be 1 to ${MAX_CLIENT_NAME_LENGTH} visible characters`,
    )
  return {
    ok: true,
    client: { name, redirectUris: [...new Set(parsed.data.redirect_uris)] },
  }
}
