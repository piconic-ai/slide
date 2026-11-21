/** Why an address cannot be kept as a link. */
export type HttpsUrlRefusal =
  | 'invalid'
  | 'not_https'
  | 'credentials'
  | 'too_long'

export type HttpsUrlParse =
  | Readonly<{ ok: true; url: string }>
  | Readonly<{ ok: false; reason: HttpsUrlRefusal }>

const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f]/u

/**
 * An https: address with no user name or password, in the form the URL parser
 * writes it. Whitespace is refused rather than dropped, since URL parsing
 * silently removes tabs and line breaks. `max` bounds both the text as typed
 * and the written form. Every place the service keeps an address an author
 * typed (related links, profile links) checks it here.
 */
export function parseHttpsUrl(raw: string, max: number): HttpsUrlParse {
  const text = raw.trim()
  if (text.length > max) return { ok: false, reason: 'too_long' }
  if (text === '' || WHITESPACE_OR_CONTROL.test(text))
    return { ok: false, reason: 'invalid' }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not_https' }
  if (url.username !== '' || url.password !== '')
    return { ok: false, reason: 'credentials' }
  if (url.href.length > max) return { ok: false, reason: 'too_long' }
  return { ok: true, url: url.href }
}
