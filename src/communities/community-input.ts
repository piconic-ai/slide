import { COMMUNITY_COLORS, type CommunityColor } from '../site/cover-pattern'

/**
 * What a person types about a community, read before it is kept (D-37,
 * D-41): its name, its description, its color and its other links.
 */

/** The longest name, in characters (D-41). */
export const NAME_MAX = 50
/** The longest description, in characters (D-41). */
export const DESCRIPTION_MAX = 160
/** How many other links a community may show (D-37). */
export const MAX_SITES = 3
/** The longest other link, in characters. */
export const SITE_MAX = 300

export type NameRefusal = 'empty' | 'too_long'
export type DescriptionRefusal = 'too_long'
export type SiteRefusal = 'invalid' | 'too_many'

type Read<T, R> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; reason: R }>

// Control characters (C0 and C1, but not the line feed), format characters
// (zero-width spaces, direction marks and overrides) and the line and
// paragraph separators: none of them is part of a name. The joiners stay,
// as emoji and some scripts are written with them.
const HIDDEN = /(?![\u200c\u200d])[\p{Cc}\p{Cf}\u2028\u2029]/gu

/** How many characters a person sees: code points, not UTF-16 units. */
const lengthOf = (text: string) => [...text].length

const asText = (input: unknown) => (typeof input === 'string' ? input : '')

/**
 * A community's color as a form sends it (F30-AC45): exactly one of the
 * five names, or nothing.
 */
export const parseColor = (input: unknown): CommunityColor | null =>
  COMMUNITY_COLORS.find((color) => color === input) ?? null

/**
 * A community's name: trimmed, without hidden characters, 1 to NAME_MAX
 * characters. HTML in it is kept as text; pages escape it.
 */
export function parseName(input: unknown): Read<string, NameRefusal> {
  const name = asText(input).replace(HIDDEN, '').trim()
  if (name === '') return { ok: false, reason: 'empty' }
  if (lengthOf(name) > NAME_MAX) return { ok: false, reason: 'too_long' }
  return { ok: true, value: name }
}

/**
 * A community's description: plain text, its lines kept (written CR LF or
 * CR, they become LF), other hidden characters removed, up to
 * DESCRIPTION_MAX characters. It may be empty. Addresses in it stay text
 * (D-41).
 */
export function parseDescription(
  input: unknown,
): Read<string, DescriptionRefusal> {
  const description = asText(input)
    .replace(/\r\n?/gu, '\n')
    .replace(/[^\S\n]*\n[^\S\n]*/gu, '\n')
    .split('\n')
    .map((line) => line.replace(HIDDEN, ''))
    .join('\n')
    .trim()
  if (lengthOf(description) > DESCRIPTION_MAX)
    return { ok: false, reason: 'too_long' }
  return { ok: true, value: description }
}

/** One other link: an http(s) address with a host, written in https. */
function parseSite(input: string): string | null {
  const text = input.trim()
  if (!/^https?:\/\//iu.test(text) || text.length > SITE_MAX) return null
  try {
    const url = new URL(text)
    if (url.username !== '' || url.password !== '') return null
    if (!url.hostname.includes('.')) return null
    url.protocol = 'https:'
    return url.href
  } catch {
    return null
  }
}

/** One field of the other links, as the form shows it again. */
export type SiteField = Readonly<{ value: string; problem: SiteRefusal | null }>

/**
 * The other links of a form (D-37): empty fields left out, each an http(s)
 * address, at most MAX_SITES. Every field keeps what was typed.
 */
export function parseSites(
  inputs: readonly string[],
):
  | Readonly<{ ok: true; sites: readonly string[] }>
  | Readonly<{ ok: false; fields: readonly SiteField[] }> {
  const typed = inputs.filter((value) => value.trim() !== '')
  const parsed = typed.map((value) => ({ value, site: parseSite(value) }))
  const fields = parsed.map(({ value, site }, index) => ({
    value,
    problem:
      site === null
        ? ('invalid' as const)
        : index >= MAX_SITES
          ? ('too_many' as const)
          : null,
  }))
  if (fields.some((field) => field.problem !== null))
    return { ok: false, fields }
  return { ok: true, sites: [...new Set(parsed.map(({ site }) => site ?? ''))] }
}

/**
 * The other links as they were stored (a JSON array), read again; anything
 * that is not such a list of addresses reads as none.
 */
export function storedSites(json: string): readonly string[] {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  return value
    .filter((site): site is string => typeof site === 'string')
    .flatMap((site) => {
      const parsed = parseSite(site)
      return parsed === null ? [] : [parsed]
    })
    .slice(0, MAX_SITES)
}
