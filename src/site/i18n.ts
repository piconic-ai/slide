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

/** E, refusing any top-level key that T lacks. */
type Exactly<T, E> = E & Readonly<Record<Exclude<keyof E, keyof T>, never>>

/**
 * A screen's wording in every language. The default language's entry sets
 * the shape; another language missing a key, or carrying a top-level key
 * the default lacks, fails the type check, whether it is written inline or
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
