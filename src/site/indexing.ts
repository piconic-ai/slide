/**
 * Paths on the management origin that search engines must not index. Owner
 * pages and APIs are private; only the top page may be listed.
 */
const PRIVATE_PREFIXES = [
  '/account/',
  '/api/',
  '/auth/',
  '/decks',
  '/uploads/',
] as const

export const ROBOTS_TXT = [
  'User-agent: *',
  ...PRIVATE_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
  '',
].join('\n')

export const isIndexablePath = (path: string): boolean =>
  path === '/' || path === '/robots.txt'
