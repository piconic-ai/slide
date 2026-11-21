import { parseHttpsUrl } from '../share/https-url'

/** What a profile may hold, in characters (code points, so an emoji is one). */
export const NAME_MAX = 50
export const BIO_MAX = 160
export const LOCATION_MAX = 50
export const LINKS_MAX = 3
const URL_MAX = 2048

/** How many characters a text has, counting an emoji as one. */
export const lengthOf = (text: string) => Array.from(text).length

/**
 * Characters that draw nothing or move other text around: controls, line and
 * paragraph separators, and format characters (the zero-width space, the byte
 * order mark, direction marks and overrides). The two zero-width joiners stay,
 * because emoji sequences are made of them.
 */
const INVISIBLE = /(?![\u{200C}\u{200D}])[\p{Cc}\p{Zl}\p{Zp}\p{Cf}]/gu

/**
 * Text for a one-line field: invisible characters and every kind of line
 * break become one space, runs of white space become one, and a lone
 * surrogate becomes U+FFFD.
 */
export const oneLineOf = (value: string): string =>
  value.toWellFormed().replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim()

/**
 * Text for the bio. Line breaks are kept (provisional; the spec leaves their
 * treatment open): every kind becomes `\n`, three or more in a row become a
 * blank line, white space at the ends of a line is dropped and invisible
 * characters become spaces.
 */
export const multiLineOf = (value: string): string =>
  value
    .toWellFormed()
    .replace(/\r\n|[\r\u{85}\p{Zl}\p{Zp}]/gu, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(INVISIBLE, (mark) => (mark === '\n' ? mark : ' '))
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** Why a typed address cannot be a link on a profile. */
export type UrlRefusal = 'invalid' | 'not_https' | 'too_long'

export type UrlCheck =
  | Readonly<{ kind: 'valid'; url: string }>
  | Readonly<{ kind: 'refused'; reason: UrlRefusal }>

/**
 * An address a profile may link to: written out in full, `https:` only, with
 * a host that has a dot and no user name or password. The address is kept in
 * the form the URL parser writes it, which is at most 2048 characters.
 */
export function checkUrl(value: string): UrlCheck {
  const parsed = parseHttpsUrl(value, URL_MAX)
  if (!parsed.ok)
    return {
      kind: 'refused',
      reason: parsed.reason === 'credentials' ? 'invalid' : parsed.reason,
    }
  if (!new URL(parsed.url).hostname.includes('.'))
    return { kind: 'refused', reason: 'invalid' }
  return { kind: 'valid', url: parsed.url }
}

/**
 * A stored address as a link, or null. A stored value becomes a link, so it
 * passes the same check as a typed one.
 */
export const linkOf = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const check = checkUrl(value)
  return check.kind === 'valid' ? check.url : null
}

/** The stored bio as it is shown, never longer than a bio may be. */
export const bioOf = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const text = Array.from(multiLineOf(value))
    .slice(0, BIO_MAX)
    .join('')
    .trimEnd()
  return text || null
}

/** A site's address as readers know it: the host, and a path when it has one. */
export const websiteLabel = (website: string) => {
  const url = new URL(website)
  return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
}
