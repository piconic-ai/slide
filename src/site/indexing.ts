import { HELP_AIMS } from '../help/aims'
import type { LegalText } from '../legal/document'
import {
  indexableLegalPaths,
  LEGAL_TEXTS,
  type LegalTextKind,
} from '../legal/documents'

/**
 * Paths on the management origin that search engines must not index. Owner
 * pages and APIs are private; only the top page, the help and share URLs may be listed.
 */
const PRIVATE_PREFIXES = [
  '/account/',
  '/api/',
  '/auth/',
  '/my/',
  '/settings',
  '/uploads/',
] as const

export const ROBOTS_TXT = [
  'User-agent: *',
  ...PRIVATE_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
  '',
].join('\n')

/**
 * The help's entrance, the list of each aim and an article under it. Only a
 * path of this shape may be listed; whether the article exists is the
 * route's to say, and a missing one is not a success, so it is not listed.
 */
const HELP_PAGE = new RegExp(
  `^/help/(?:${HELP_AIMS.join('|')})(?:/[a-z0-9]+(?:-[a-z0-9]+)*)?$`,
  'u',
)

/**
 * Share URLs of public decks, such as /@kfly8/good-slide, may be listed. So
 * may a legal text once it has a date; a draft may not (D-21). `legal` is the
 * set of texts to judge by, the ones the service carries unless a test gives
 * others.
 */
export const isIndexablePath = (
  path: string,
  legal: Readonly<Record<LegalTextKind, LegalText>> = LEGAL_TEXTS,
): boolean =>
  path === '/' ||
  path === '/help' ||
  path === '/help/bot' ||
  HELP_PAGE.test(path) ||
  path === '/robots.txt' ||
  path.startsWith('/@') ||
  indexableLegalPaths(legal).has(path)
