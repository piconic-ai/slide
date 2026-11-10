import type { Context, MiddlewareHandler } from 'hono'
import { setCookie } from 'hono/cookie'
import { languageDetector } from 'hono/language'
import {
  DEFAULT_LANG,
  isLang,
  LANG_COOKIE,
  LANG_PARAM,
  LANGS,
  type Lang,
} from './i18n'
import { isHtml } from './no-transform'
import { withVary } from './vary'

/**
 * Picks the screen language from `?lang=`, then the cookie, then
 * Accept-Language. An unsupported value is skipped, so the next source
 * decides; with none left the page is Japanese. Detection writes no cookie:
 * a public page answers without Set-Cookie unless the reader switched.
 */
const detect = languageDetector({
  supportedLanguages: [...LANGS],
  fallbackLanguage: DEFAULT_LANG,
  order: ['querystring', 'cookie', 'header'],
  lookupQueryString: LANG_PARAM,
  lookupCookie: LANG_COOKIE,
  caches: false,
})

/**
 * Keeps an explicit switch. Lax, not Strict, so the choice also applies when
 * a link from another site opens a shared deck.
 */
const remember: MiddlewareHandler = async (c, next) => {
  await next()
  const chosen = c.req.query(LANG_PARAM)
  if (isLang(chosen))
    setCookie(c, LANG_COOKIE, chosen, {
      path: '/',
      sameSite: 'Lax',
      secure: true,
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
    })
}

/**
 * Pages are worded by language, so a cache must not hand one reader's page
 * to another. A 304 gets the same header, which caches copy into the page.
 */
const vary: MiddlewareHandler = async (c, next) => {
  await next()
  if (c.res.status === 304 || isHtml(c.res.headers.get('Content-Type')))
    c.res.headers.set(
      'Vary',
      withVary(c.res.headers.get('Vary'), ['Accept-Language', 'Cookie']),
    )
}

export const langMiddleware = [detect, remember, vary] as const

/** The language detected for this request. */
export const langOf = (c: Context): Lang => {
  const lang = c.get('language')
  return isLang(lang) ? lang : DEFAULT_LANG
}
