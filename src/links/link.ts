import { parseHttpsUrl, type HttpsUrlRefusal } from '../share/https-url'
import { kindOfUrl } from './kind'

export const LINK_KINDS = ['video', 'article', 'other'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

/** How many related links one deck may have. */
export const MAX_LINKS = 10
/** How many characters (code points) a title may have. */
export const MAX_TITLE_LENGTH = 100
/** How long a URL may be, as the author typed it. */
export const MAX_URL_LENGTH = 2000

/** What an author gives to add a link, as parsed. */
export type LinkInput = Readonly<{
  kind: LinkKind
  /** The normalized https: URL. */
  url: string
  /** What the author typed, or null when they left it empty: it is fetched. */
  title: string | null
}>

/** Why a link was refused; each one has its own sentence on the page. */
export const LINK_REFUSALS = [
  'kind',
  'url_invalid',
  'url_scheme',
  'url_credentials',
  'url_too_long',
  'title_missing',
  'title_too_long',
  'title_invalid',
] as const
export type LinkRefusal = (typeof LINK_REFUSALS)[number]

export type LinkParse =
  | Readonly<{ ok: true; link: LinkInput }>
  | Readonly<{ ok: false; reason: LinkRefusal }>

const refuse = (reason: LinkRefusal): LinkParse => ({ ok: false, reason })

const isKind = (value: unknown): value is LinkKind =>
  LINK_KINDS.some((kind) => kind === value)

// Control characters (also the C1 ones), format characters (zero-width
// spaces, direction marks and overrides) and the line and paragraph
// separators: none of them belongs in a title.
const INVALID_IN_TITLE = /[\p{Cc}\p{Cf}\u2028\u2029]/u
// A character a reader can see: not white space, not a separator or other
// invisible code point, and not one of the blank-looking fillers.
const VISIBLE = /[^\p{White_Space}\p{Z}\p{C}\u115f\u1160\u2800\u3164\uffa0]/u

const URL_REFUSALS = {
  invalid: 'url_invalid',
  not_https: 'url_scheme',
  credentials: 'url_credentials',
  too_long: 'url_too_long',
} as const satisfies Record<HttpsUrlRefusal, LinkRefusal>

type UrlParse =
  | Readonly<{ ok: true; url: string }>
  | Readonly<{ ok: false; reason: LinkRefusal }>

/** An https: URL with no user name or password (see parseHttpsUrl). */
function parseUrl(raw: string): UrlParse {
  const parsed = parseHttpsUrl(raw, MAX_URL_LENGTH)
  return parsed.ok ? parsed : { ok: false, reason: URL_REFUSALS[parsed.reason] }
}

/** The fields of the form for adding a link, checked in the order they are shown. */
export function parseLinkInput(
  raw: Readonly<{ kind?: unknown; url: unknown; title?: unknown }>,
): LinkParse {
  // The kind is read from the address unless one is given (an agent may).
  const given = raw.kind === undefined || raw.kind === null || raw.kind === ''
  if (!given && !isKind(raw.kind)) return refuse('kind')
  const url = parseUrl(typeof raw.url === 'string' ? raw.url : '')
  if (!url.ok) return refuse(url.reason)
  const kind: LinkKind = isKind(raw.kind) ? raw.kind : kindOfUrl(url.url)
  // Not text at all is refused; absent is the same as empty.
  if (
    raw.title !== undefined &&
    raw.title !== null &&
    typeof raw.title !== 'string'
  )
    return refuse('title_invalid')
  const title = (raw.title ?? '').toString().trim()
  // Left empty (or only white space), the title is optional: it is fetched once when the link is added.
  if (title === '')
    return { ok: true, link: { kind, url: url.url, title: null } }
  if (INVALID_IN_TITLE.test(title)) return refuse('title_invalid')
  if (!VISIBLE.test(title)) return refuse('title_missing')
  if (Array.from(title).length > MAX_TITLE_LENGTH)
    return refuse('title_too_long')
  return { ok: true, link: { kind, url: url.url, title } }
}

/**
 * A title read from another site, made into one that may be kept: runs of
 * white space become one space, the ends are trimmed, and the text is cut to
 * the length a title may have. It is not trusted: one with a control, format
 * or separator character, or with nothing a reader can see, is refused (null)
 * rather than repaired.
 */
export function fetchedTitleOf(raw: string): string | null {
  const title = raw.replace(/\s+/gu, ' ').trim()
  // A character that could not be decoded is not a title.
  if (title.includes('\uFFFD')) return null
  if (INVALID_IN_TITLE.test(title) || !VISIBLE.test(title)) return null
  return Array.from(title).slice(0, MAX_TITLE_LENGTH).join('').trim()
}

/** What a link is shown as: its title, or the name of its site when it has none. */
export const linkLabelOf = (
  link: Readonly<{ url: string; title: string | null }>,
) => link.title ?? siteNameOf(link.url)

/**
 * The name of the site a link leads to: the host name of its URL. A host
 * written in another script is shown in its ASCII form (punycode), which is
 * what the address bar will resolve, so a look-alike cannot pass for another
 * site.
 */
export function siteNameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** The value a notice in the address stands for, or null for anything else. */
export const parseLinkRefusal = (value: string | undefined) =>
  LINK_REFUSALS.find((reason) => reason === value) ??
  (value === 'full' ? ('full' as const) : null)
