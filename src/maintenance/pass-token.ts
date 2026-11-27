/**
 * The values that carry "an operator passed Cloudflare Access" from the
 * operator host to the management host while maintenance holds the service
 * (D-118, docs/dev/maintenance.md, "運営の入口"). Two kinds, told apart inside
 * what is signed so that one is never taken for the other:
 *
 * - `enter`: put in the address of the management host, valid for a minute;
 * - `pass`: kept in a cookie by the management host, valid for an hour.
 *
 * A value is `v1.<kind>.<expiry>.<signature>`: the expiry in seconds, and an
 * HMAC-SHA-256 over the kind, the expiry and the value of the secret
 * MAINTENANCE, so that a value made for one maintenance does not hold for
 * another whose secret reads differently. The key is derived from a secret the
 * service already has, so that nothing new is to be set. Nothing here reads
 * the clock: `now` is given.
 */
export type PassKind = 'enter' | 'pass'

/** How long an `enter` value, which sits in an address, may be used (seconds). */
export const ENTER_LIFETIME_SECONDS = 60

/** How long a `pass` value, kept in a cookie, may be used (seconds). */
export const PASS_LIFETIME_SECONDS = 60 * 60

export const lifetimeOf = (kind: PassKind) =>
  kind === 'enter' ? ENTER_LIFETIME_SECONDS : PASS_LIFETIME_SECONDS

/** The shortest secret a key is made from. A shorter one disables the entrance. */
const MIN_SECRET_LENGTH = 16

const SHAPE = /^v1\.(enter|pass)\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/

const bytes = (text: string) => new TextEncoder().encode(text)

function base64url(data: ArrayBuffer): string {
  let text = ''
  for (const byte of new Uint8Array(data)) text += String.fromCharCode(byte)
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const padded = text.replaceAll('-', '+').replaceAll('_', '/')
    const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    return Uint8Array.from(raw, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

/** The key of the entrance, made from `secret` for this purpose alone. */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    bytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const derived = await crypto.subtle.sign(
    'HMAC',
    base,
    bytes('slide/maintenance-pass/v1'),
  )
  return crypto.subtle.importKey(
    'raw',
    derived,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

/** Whether a secret is one a key may be made from. */
export const usableSecret = (secret: string | undefined): secret is string =>
  typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH

const signedText = (kind: PassKind, expiry: number, held: string) =>
  `v1|${kind}|${expiry}|${held}`

/**
 * A value of `kind`, good until its lifetime has passed. `held` is the value
 * of the secret MAINTENANCE that holds the service now.
 */
export async function signPass(
  secret: string,
  kind: PassKind,
  held: string,
  now: number,
): Promise<Readonly<{ value: string; expiresAt: number }>> {
  const expiresAt = Math.floor(now) + lifetimeOf(kind)
  const signature = await crypto.subtle.sign(
    'HMAC',
    await deriveKey(secret),
    bytes(signedText(kind, expiresAt, held)),
  )
  return { value: `v1.${kind}.${expiresAt}.${base64url(signature)}`, expiresAt }
}

/**
 * Whether `value` is a good value of `kind` at `now` for the maintenance that
 * `held` names: well formed, not past its expiry, not claiming a longer life
 * than its kind has, written in its one canonical form (the expiry without
 * leading zeros, the signature as `signPass` encodes it), and signed with this
 * service's key. The signature is
 * compared by the platform's own `verify`, which does not leak where it
 * differs.
 */
export async function verifyPass(
  secret: string,
  value: string | undefined,
  kind: PassKind,
  held: string,
  now: number,
): Promise<boolean> {
  const match = value === undefined ? null : SHAPE.exec(value)
  if (!match || match[1] !== kind) return false
  const expiry = Number(match[2])
  if (!Number.isSafeInteger(expiry) || expiry <= now) return false
  // Canonical text only: no leading zeros, so one value has one spelling.
  if (String(expiry) !== match[2]) return false
  if (expiry > now + lifetimeOf(kind)) return false
  const signature = fromBase64url(match[3]!)
  if (!signature) return false
  // The decoder drops the spare bits of the last character; refuse any
  // spelling that does not encode back to itself.
  if (base64url(signature.buffer) !== match[3]) return false
  return crypto.subtle.verify(
    'HMAC',
    await deriveKey(secret),
    signature,
    bytes(signedText(kind, expiry, held)),
  )
}
