/**
 * How a registrant's email address is kept in D1 (F41, D-80): sealed with
 * AES-256-GCM, and found again by a lookup value, an HMAC-SHA-256 under a
 * second key. Everything here is a pure function of its arguments: the
 * caller reads the secrets, draws the IV and reads the rows. The design is
 * docs/dev/f41-email-encryption.md.
 *
 * Nothing in this file puts an address, a sealed text or a key into an error:
 * an `EmailCryptoError` carries only a code.
 */

/** The spelling every address is compared and stored in (F28). */
export const normalizeForLookup = (email: string): string =>
  email.trim().toLowerCase()

const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const FORMAT = 'ec1'
const PLACEHOLDER_PREFIX = 'enc1:'
const MAX_VERSION = 9999

export type EmailCryptoProblem =
  | 'keys_missing'
  | 'keys_malformed'
  | 'current_missing'
  | 'current_unknown'
  | 'lookup_missing'
  | 'lookup_malformed'
  | 'lookup_reused'

/**
 * What the secrets say. `off` is none of them set: addresses stay plain
 * (D-08). `invalid` is some set but not usable: nothing is written or read
 * through it, so a typo cannot quietly put plain addresses back.
 */
export type EmailCrypto =
  | Readonly<{ kind: 'off' }>
  | Readonly<{
      kind: 'on'
      keys: ReadonlyMap<number, Uint8Array>
      current: number
      lookupKey: Uint8Array
    }>
  | Readonly<{ kind: 'invalid'; problems: readonly EmailCryptoProblem[] }>

export const EMAIL_CRYPTO_OFF: EmailCrypto = { kind: 'off' }

export type EmailCryptoErrorCode =
  | 'not_usable'
  | 'malformed'
  | 'unknown_version'
  | 'auth_failed'
  | 'mismatch'
  | 'inconsistent'
  | 'unsupported_query'

export class EmailCryptoError extends Error {
  readonly code: EmailCryptoErrorCode
  constructor(code: EmailCryptoErrorCode) {
    super(`email crypto: ${code}`)
    this.name = 'EmailCryptoError'
    this.code = code
  }
}

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

const BASE64URL = /^[A-Za-z0-9_-]+$/

/** Bytes of unpadded base64url text, or null when it is not that. */
function fromBase64Url(text: string): Uint8Array | null {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null
  try {
    const padded = text.replaceAll('-', '+').replaceAll('_', '/')
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index])

type Settings = Readonly<{
  keys?: string | undefined
  current?: string | undefined
  lookupKey?: string | undefined
}>

const blank = (value: string | undefined) => (value ?? '').trim() === ''

/** `1:<key>,2:<key>`: a version, a colon and a 32-byte key in base64url. */
function parseKeys(text: string): Map<number, Uint8Array> | 'keys_malformed' {
  const keys = new Map<number, Uint8Array>()
  for (const part of text.split(',')) {
    const [version, key, ...rest] = part.trim().split(':')
    const number = Number(version)
    const bytes = fromBase64Url(key ?? '')
    if (
      rest.length > 0 ||
      !/^[1-9][0-9]*$/.test(version ?? '') ||
      number > MAX_VERSION ||
      keys.has(number) ||
      bytes === null ||
      bytes.length !== KEY_BYTES
    )
      return 'keys_malformed'
    keys.set(number, bytes)
  }
  return keys
}

type Part<T> = Readonly<{ value: T; problems: EmailCryptoProblem[] }>

/** The encryption keys; a missing or malformed list is a problem. */
function readKeys(text: string | undefined): Part<Map<number, Uint8Array>> {
  if (blank(text)) return { value: new Map(), problems: ['keys_missing'] }
  const parsed = parseKeys(text as string)
  return parsed === 'keys_malformed'
    ? { value: new Map(), problems: [parsed] }
    : { value: parsed, problems: [] }
}

/** The version that encrypts; it must be one of the keys that were read. */
function readCurrent(
  text: string | undefined,
  keys: ReadonlyMap<number, Uint8Array>,
): Part<number> {
  const value = Number((text ?? '').trim())
  if (blank(text)) return { value, problems: ['current_missing'] }
  return keys.size > 0 && !keys.has(value)
    ? { value, problems: ['current_unknown'] }
    : { value, problems: [] }
}

/** The lookup key; it must not be one of the encryption keys. */
function readLookupKey(
  text: string | undefined,
  keys: ReadonlyMap<number, Uint8Array>,
): Part<Uint8Array> {
  const none = new Uint8Array()
  if (blank(text)) return { value: none, problems: ['lookup_missing'] }
  const bytes = fromBase64Url((text as string).trim())
  if (bytes === null || bytes.length < KEY_BYTES)
    return { value: none, problems: ['lookup_malformed'] }
  const reused = [...keys.values()].some((key) => sameBytes(key, bytes))
  return { value: bytes, problems: reused ? ['lookup_reused'] : [] }
}

/**
 * Reads the three secrets (EMAIL_CIPHER_KEYS, EMAIL_CIPHER_CURRENT,
 * EMAIL_LOOKUP_KEY). All three absent is `off`; anything else must be whole
 * and well formed, and the lookup key must not be one of the encryption keys.
 */
export function parseEmailCrypto(settings: Settings): EmailCrypto {
  const {
    keys: keyText,
    current: currentText,
    lookupKey: lookupText,
  } = settings
  if (blank(keyText) && blank(currentText) && blank(lookupText))
    return EMAIL_CRYPTO_OFF
  const keys = readKeys(keyText)
  const current = readCurrent(currentText, keys.value)
  const lookupKey = readLookupKey(lookupText, keys.value)
  const problems = [
    ...keys.problems,
    ...current.problems,
    ...lookupKey.problems,
  ]
  return problems.length > 0
    ? { kind: 'invalid', problems }
    : {
        kind: 'on',
        keys: keys.value,
        current: current.value,
        lookupKey: lookupKey.value,
      }
}

/** The key versions a configuration holds, ascending. */
export const keyVersions = (crypto: EmailCrypto): number[] =>
  crypto.kind === 'on' ? [...crypto.keys.keys()].sort((a, b) => a - b) : []

const hmac = async (key: Uint8Array, text: string): Promise<Uint8Array> => {
  const imported = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(text)),
  )
}

function usable(config: EmailCrypto): Extract<EmailCrypto, { kind: 'on' }> {
  if (config.kind !== 'on') throw new EmailCryptoError('not_usable')
  return config
}

/**
 * The lookup value of an address: HMAC-SHA-256 of its normalized spelling,
 * as 64 lowercase hexadecimal digits. Equal addresses give equal values;
 * without the lookup key no one can compute one.
 */
export async function lookupOf(
  config: EmailCrypto,
  email: string,
): Promise<string> {
  const { lookupKey } = usable(config)
  return hex(await hmac(lookupKey, `address:${normalizeForLookup(email)}`))
}

/**
 * What a stored identifier of a one-time code becomes (Better Auth's
 * `verification.storeIdentifier`): the code row names the address, so the
 * whole identifier is replaced by its own keyed hash.
 */
export async function hashedIdentifier(
  config: EmailCrypto,
  identifier: string,
): Promise<string> {
  const { lookupKey } = usable(config)
  return base64Url(await hmac(lookupKey, `verification:${identifier}`))
}

/**
 * What the `email` column holds in an encrypted row: a text no address can
 * be (an address has no colon), made of the lookup value. The column keeps
 * its NOT NULL and UNIQUE (or PRIMARY KEY) as they were, and so keeps one
 * row per address without a new index. It is also all lowercase, as the
 * invitations' CHECK needs.
 */
export const placeholderOf = (lookup: string) =>
  `${PLACEHOLDER_PREFIX}${lookup}`

export const isPlaceholder = (text: string) =>
  text.startsWith(PLACEHOLDER_PREFIX)

/** The forms an address can have in a row, for `WHERE email IN (…)`. */
export async function storedForms(
  config: EmailCrypto,
  email: string,
): Promise<string[]> {
  const plain = normalizeForLookup(email)
  return config.kind === 'on'
    ? [plain, placeholderOf(await lookupOf(config, plain))]
    : [plain]
}

const concat = (a: Uint8Array, b: Uint8Array) => {
  const joined = new Uint8Array(a.length + b.length)
  joined.set(a)
  joined.set(b, a.length)
  return joined
}

const aesKey = (bytes: Uint8Array) =>
  crypto.subtle.importKey('raw', bytes as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])

/**
 * Seals an address under the current key. `iv` is 12 fresh random bytes,
 * drawn by the caller: the same address sealed twice reads differently.
 * The text is `ec1.<key version>.<iv>.<ciphertext>.<tag>`, the three binary
 * parts in unpadded base64url. The address is sealed as normalized.
 */
export async function sealEmail(
  config: EmailCrypto,
  email: string,
  iv: Uint8Array,
): Promise<string> {
  const on = usable(config)
  const address = normalizeForLookup(email)
  if (iv.length !== IV_BYTES || address === '')
    throw new EmailCryptoError('malformed')
  const key = on.keys.get(on.current)
  if (!key) throw new EmailCryptoError('unknown_version')
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      await aesKey(key),
      new TextEncoder().encode(address),
    ),
  )
  const cut = sealed.length - TAG_BYTES
  return [
    FORMAT,
    String(on.current),
    base64Url(iv),
    base64Url(sealed.slice(0, cut)),
    base64Url(sealed.slice(cut)),
  ].join('.')
}

export type SealedParts = Readonly<{
  version: number
  iv: Uint8Array
  body: Uint8Array
  tag: Uint8Array
}>

/** Splits a sealed text, or null when it is not one. Reads no key. */
export function partsOfSealed(text: string): SealedParts | null {
  const fields = text.split('.')
  if (fields.length !== 5 || fields[0] !== FORMAT) return null
  const [, version, iv, body, tag] = fields as [
    string,
    string,
    string,
    string,
    string,
  ]
  if (!/^[1-9][0-9]{0,3}$/.test(version)) return null
  const bytes = [iv, body, tag].map(fromBase64Url)
  const [ivBytes, bodyBytes, tagBytes] = bytes
  if (!ivBytes || !bodyBytes || !tagBytes) return null
  if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) return null
  return {
    version: Number(version),
    iv: ivBytes,
    body: bodyBytes,
    tag: tagBytes,
  }
}

/** The key version a sealed text names, or null when it is not one. */
export const versionOfSealed = (text: string): number | null =>
  partsOfSealed(text)?.version ?? null

/**
 * Opens a sealed text with the key of the version it names. A version this
 * configuration does not hold, a text that is not a sealed address, and a
 * text that was changed in any bit are each refused with a code.
 */
export async function openEmail(
  config: EmailCrypto,
  text: string,
): Promise<string> {
  const on = usable(config)
  const parts = partsOfSealed(text)
  if (!parts) throw new EmailCryptoError('malformed')
  const key = on.keys.get(parts.version)
  if (!key) throw new EmailCryptoError('unknown_version')
  try {
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: parts.iv as BufferSource },
      await aesKey(key),
      concat(parts.body, parts.tag) as BufferSource,
    )
    return new TextDecoder('utf-8', { fatal: true }).decode(opened)
  } catch {
    throw new EmailCryptoError('auth_failed')
  }
}

/** What the two address columns of a row hold. */
export type AddressColumns = Readonly<{
  email: string
  emailCiphertext: string | null
}>

/**
 * The address a row stands for. A row with no sealed text is plain and its
 * `email` is the address; a row with one is opened, and what comes out must
 * be the address whose lookup value is in `email`, so a sealed text moved to
 * another row is refused. A placeholder with no sealed text, or a sealed
 * text with a plain `email`, is an inconsistent row.
 */
export async function addressOf(
  config: EmailCrypto,
  row: AddressColumns,
): Promise<string> {
  if (row.emailCiphertext === null) {
    if (isPlaceholder(row.email)) throw new EmailCryptoError('inconsistent')
    return row.email
  }
  if (!isPlaceholder(row.email)) throw new EmailCryptoError('inconsistent')
  const address = await openEmail(config, row.emailCiphertext)
  if (placeholderOf(await lookupOf(config, address)) !== row.email)
    throw new EmailCryptoError('mismatch')
  return address
}

/**
 * The two columns to write for an address: all sealed when the keys are on,
 * the plain address when they are off, and nothing when they are invalid.
 */
export async function columnsFor(
  config: EmailCrypto,
  email: string,
  iv: Uint8Array,
): Promise<AddressColumns> {
  const plain = normalizeForLookup(email)
  if (config.kind === 'off') return { email: plain, emailCiphertext: null }
  return {
    email: placeholderOf(await lookupOf(config, plain)),
    emailCiphertext: await sealEmail(config, plain, iv),
  }
}

/**
 * The identifier of a one-time code's row as D1 holds it: the identifier
 * itself while the keys are off, its keyed hash while they are on. The same
 * rule as Better Auth's `storeIdentifier` hook, for the code that reads or
 * deletes those rows itself.
 */
export async function storedIdentifier(
  config: EmailCrypto,
  identifier: string,
): Promise<string> {
  return config.kind === 'off'
    ? identifier
    : hashedIdentifier(config, identifier)
}
