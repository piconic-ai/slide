// The address that returns one stored file to an agent (D-38). Pure: the
// secret and the time are arguments, nothing is read or written here.
//
// An address carries a signature over what it may open: one connection, one
// version, one file, and the time it stops. The signature is an HMAC-SHA256
// under a key derived (HKDF) from the service's own secret for this one use,
// so no value made for another use can be taken for an address, and the
// address names nothing it was not signed for. See
// docs/dev/f35-agent-export.md.
import { z } from 'zod'

/** Where the addresses are: `<origin>/mcp/files/<value>`. */
export const FILES_PATH = '/mcp/files'

/** The address of a signed value, against the service's own origin. */
export const fileUrlOf = (origin: string, value: string): string =>
  new URL(`${FILES_PATH}/${value}`, origin).href

/** How long an address opens its file. */
export const FILE_URL_SECONDS = 60 * 60
/** Nothing longer than this is read as an address, signature unchecked. */
export const MAX_FILE_URL_VALUE_LENGTH = 600
/** Names the use of the key; changing it ends every address made so far. */
const KEY_INFO = 'slide/mcp-export-file-url/v1'

const encoder = new TextEncoder()

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

const BASE64URL = /^[A-Za-z0-9_-]+$/

/**
 * The bytes of canonical base64url text, or null. The text must be exactly
 * what writing the bytes would give: a spelling that decodes to the same
 * bytes (spare bits in the last character) is a different value, and a value
 * that is not the one signed opens nothing.
 */
function fromBase64Url(text: string): Uint8Array | null {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null
  try {
    const bytes = Uint8Array.from(
      atob(text.replaceAll('-', '+').replaceAll('_', '/')),
      (char) => char.charCodeAt(0),
    )
    return toBase64Url(bytes) === text ? bytes : null
  } catch {
    return null
  }
}

/** What an address opens: this connection's read of this one file. */
export type FileUrlClaims = Readonly<{
  grantId: string
  deploymentId: string
  fileId: string
  /** Seconds since the epoch; the address does not open at this time or later. */
  expiresAt: number
}>

const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const claimsSchema = z.tuple([
  z.literal('v1'),
  ID,
  ID,
  ID,
  z.number().int().nonnegative(),
])

/** The key addresses are signed and checked with, for one secret. */
export async function fileUrlKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: encoder.encode(KEY_INFO),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  )
}

/** The value of the address (its last path segment) for these claims. */
export async function signFileUrl(
  key: CryptoKey,
  claims: FileUrlClaims,
): Promise<string> {
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify([
        'v1',
        claims.grantId,
        claims.deploymentId,
        claims.fileId,
        claims.expiresAt,
      ]),
    ),
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return `${payload}.${toBase64Url(new Uint8Array(mac))}`
}

export type OpenedFileUrl =
  | Readonly<{ kind: 'ok'; claims: FileUrlClaims }>
  /** Signed by this service and past its time. Nothing else can be this. */
  | Readonly<{ kind: 'expired' }>
  /** Not an address this service signed: no more is said about why. */
  | Readonly<{ kind: 'invalid' }>

/**
 * Reads the value of an address. The signature is checked first and in
 * constant time, so a value that was not signed here is `invalid` whatever
 * else is wrong with it, and only a signed value can be told it has expired.
 */
export async function openFileUrl(
  key: CryptoKey,
  value: string,
  now: number,
): Promise<OpenedFileUrl> {
  const invalid = { kind: 'invalid' } as const
  if (value.length > MAX_FILE_URL_VALUE_LENGTH) return invalid
  const parts = value.split('.')
  if (parts.length !== 2) return invalid
  const [payload = '', signature = ''] = parts
  const mac = fromBase64Url(signature)
  if (!mac || mac.length !== 32 || !BASE64URL.test(payload)) return invalid
  const signed = await crypto.subtle.verify(
    'HMAC',
    key,
    new Uint8Array(mac),
    encoder.encode(payload),
  )
  if (!signed) return invalid
  const body = fromBase64Url(payload)
  if (!body) return invalid
  let claims: z.infer<typeof claimsSchema>
  try {
    claims = claimsSchema.parse(JSON.parse(new TextDecoder().decode(body)))
  } catch {
    return invalid
  }
  const [, grantId, deploymentId, fileId, expiresAt] = claims
  if (now >= expiresAt) return { kind: 'expired' }
  return { kind: 'ok', claims: { grantId, deploymentId, fileId, expiresAt } }
}
