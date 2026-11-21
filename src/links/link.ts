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
  title: string
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
const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f]/u

type UrlParse =
  | Readonly<{ ok: true; url: string }>
  | Readonly<{ ok: false; reason: LinkRefusal }>

/**
 * An https: URL with no user name or password. Whitespace is refused rather
 * than dropped, since URL parsing silently removes tabs and line breaks.
 */
function parseUrl(raw: string): UrlParse {
  const text = raw.trim()
  if (text.length > MAX_URL_LENGTH) return { ok: false, reason: 'url_too_long' }
  if (text === '' || WHITESPACE_OR_CONTROL.test(text))
    return { ok: false, reason: 'url_invalid' }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, reason: 'url_invalid' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'url_scheme' }
  if (url.username !== '' || url.password !== '')
    return { ok: false, reason: 'url_credentials' }
  if (url.href.length > MAX_URL_LENGTH)
    return { ok: false, reason: 'url_too_long' }
  return { ok: true, url: url.href }
}

/** The fields of the form for adding a link, checked in the order they are shown. */
export function parseLinkInput(
  raw: Readonly<{ kind: unknown; url: unknown; title: unknown }>,
): LinkParse {
  if (!isKind(raw.kind)) return refuse('kind')
  const url = parseUrl(typeof raw.url === 'string' ? raw.url : '')
  if (!url.ok) return refuse(url.reason)
  const title = (typeof raw.title === 'string' ? raw.title : '').trim()
  if (INVALID_IN_TITLE.test(title)) return refuse('title_invalid')
  if (!VISIBLE.test(title)) return refuse('title_missing')
  if (Array.from(title).length > MAX_TITLE_LENGTH)
    return refuse('title_too_long')
  return { ok: true, link: { kind: raw.kind, url: url.url, title } }
}

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
