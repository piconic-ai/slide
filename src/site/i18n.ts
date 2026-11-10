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

/** Each language's name in that language, as the switcher shows it. */
export const LANG_NAMES: Readonly<Record<Lang, string>> = {
  ja: '日本語',
  en: 'English',
}

type OtherLang = Exclude<Lang, typeof DEFAULT_LANG>

/**
 * A screen's wording in every language. The default language's entry sets
 * the shape; another language missing a key, or carrying one the default
 * lacks, fails the type check.
 */
export const messages = <T>(
  dict: Readonly<Record<typeof DEFAULT_LANG, T>> &
    Readonly<Record<OtherLang, NoInfer<T>>>,
): Readonly<Record<Lang, T>> => dict

/** The same page in another language: its path and query, `lang` replaced. */
export function langHref(url: URL, lang: Lang) {
  const params = new URLSearchParams(url.search)
  params.set(LANG_PARAM, lang)
  return `${url.pathname}?${params}`
}
