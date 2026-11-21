/**
 * Keeps a login code in a form only this service can read back. A code that
 * can be read back can be sent again unchanged, so asking for a code never
 * voids the one a person already holds (F28-AC9's neighbour: nobody can lock
 * someone else out by asking for their code again).
 */
const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0),
  )

const keyOf = async (secret: string) =>
  crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  )

/**
 * The nonce is derived from the secret and the code, so this needs no random
 * source. Equal codes seal to equal text, which tells no one anything: a
 * code is six digits and the text is useless without the secret.
 */
const nonceOf = async (secret: string, code: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`nonce:${code}`),
  )
  return new Uint8Array(mac).slice(0, 12)
}

export const encryptCode = async (secret: string, code: string) => {
  const iv = await nonceOf(secret, code)
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await keyOf(secret),
      new TextEncoder().encode(code),
    ),
  )
  return base64Url(new Uint8Array([...iv, ...sealed]))
}

export const decryptCode = async (secret: string, stored: string) => {
  const bytes = fromBase64Url(stored)
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12) },
    await keyOf(secret),
    bytes.slice(12),
  )
  return new TextDecoder().decode(opened)
}
