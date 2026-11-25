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

/** Share URLs of public decks, such as /@kfly8/good-slide, may be listed. */
export const isIndexablePath = (path: string): boolean =>
  path === '/' ||
  path === '/help' ||
  path === '/help/bot' ||
  path === '/robots.txt' ||
  path.startsWith('/@')
