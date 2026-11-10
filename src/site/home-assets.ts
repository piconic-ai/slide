import type { Lang } from './i18n'

/**
 * Where each language's generated top page sits in Static Assets. Readers
 * reach them only through `/`, which picks one by the request's language;
 * `/` itself is the Japanese file so the default needs no lookup.
 */
export const HOME_ASSET_PATHS: Readonly<Record<Lang, string>> = {
  ja: '/',
  en: '/_home/en/',
}

/**
 * Requests the Worker answers instead of Static Assets: the top page, and
 * the generated pages behind it, which would otherwise be served without
 * the page headers.
 */
export const isHomeAssetPath = (pathname: string) =>
  pathname === '/' || pathname === '/_home' || pathname.startsWith('/_home/')
