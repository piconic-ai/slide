/** Languages the service screens are written in. */
export const LANGS = ['ja', 'en'] as const
export type Lang = (typeof LANGS)[number]

/** Used when a request names no supported language. */
export const DEFAULT_LANG = 'ja' satisfies Lang

/** The query parameter that switches the language, as in `?lang=en`. */
export const LANG_PARAM = 'lang'

/** The cookie that keeps a language the reader chose. */
export const LANG_COOKIE = 'language'

export const isLang = (value: unknown): value is Lang =>
  typeof value === 'string' && (LANGS as readonly string[]).includes(value)

/**
 * The supported language a tag names, matched the way the detector matches
 * it: ignoring case and space, and a region (`en-US`) falls back to its
 * language. Undefined when the tag names no supported language.
 */
export function langOfTag(tag: string | undefined): Lang | undefined {
  const [primary] = (tag ?? '').trim().toLowerCase().split('-')
  return isLang(primary) ? primary : undefined
}

/** Each language's name in that language, as the switcher shows it. */
export const LANG_NAMES: Readonly<Record<Lang, string>> = {
  ja: '日本語',
  en: 'English',
}

type OtherLang = Exclude<Lang, typeof DEFAULT_LANG>

/**
 * E, refusing any key that T lacks at any depth. Functions, strings and
 * rendered markup are compared as they are; their own keys are not wording.
 */
type Exactly<T, E> = E extends
  | string
  | String
  | PromiseLike<unknown>
  | ((...args: never[]) => unknown)
  ? E
  : E extends object
    ? { [K in keyof E]: K extends keyof T ? Exactly<T[K], E[K]> : never }
    : E

/**
 * A screen's wording in every language. The default language's entry sets
 * the shape; another language missing a key, or carrying a key the default
 * lacks at any depth, fails the type check, whether it is written inline or
 * passed as a variable. With T given explicitly, extra keys are left to
 * each dictionary's own annotation.
 */
export const messages = <
  T,
  E extends Readonly<Record<OtherLang, NoInfer<T>>> = Readonly<
    Record<OtherLang, T>
  >,
>(
  dict: Readonly<Record<typeof DEFAULT_LANG, T>> &
    E & { readonly [L in OtherLang]: Exactly<NoInfer<T>, E[L]> },
): Readonly<Record<Lang, T>> => dict

/** The same page in another language: its path and query, `lang` replaced. */
export function langHref(url: URL, lang: Lang) {
  const params = new URLSearchParams(url.search)
  params.set(LANG_PARAM, lang)
  // A path starting `//` would read as another host; keep the link here.
  const path = `/${url.pathname.replace(/^\/+/, '')}`
  return `${path}?${params}`
}

/**
 * A `Link` header naming the page in every language for search engines,
 * whose requests usually carry no Accept-Language. Each URL is the bare page
 * plus `lang`: other query parameters (tracking tags and the like) are not
 * part of the page. The page without `lang` is the default that picks by
 * the reader's browser.
 */
export function alternateLinks(origin: string, url: URL) {
  // langHref keeps a `//host` path on this site.
  const page = new URL(langHref(url, DEFAULT_LANG), origin)
  page.search = ''
  const link = (href: string, hreflang: string) =>
    `<${href}>; rel="alternate"; hreflang="${hreflang}"`
  return [
    ...LANGS.map((lang) =>
      link(new URL(langHref(page, lang), origin).href, lang),
    ),
    link(page.href, 'x-default'),
  ].join(', ')
}
