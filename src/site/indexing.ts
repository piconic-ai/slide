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
  '/slides',
  '/settings',
  '/uploads/',
] as const

export const ROBOTS_TXT = [
  'User-agent: *',
  ...PRIVATE_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
  '',
].join('\n')

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
  path === '/robots.txt' ||
  path.startsWith('/@') ||
  indexableLegalPaths(legal).has(path)
