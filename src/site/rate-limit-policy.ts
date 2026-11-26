/**
 * Request groups with their own per-IP rate limit. An upload sends one
 * request per file, so uploads get a separate, larger budget than owner pages.
 * Readers of a talk often share one venue's address, so share URLs and
 * deployment origins get the largest budgets.
 */
export type LimitGroup =
  | 'auth'
  | 'uploads'
  | 'management'
  | 'viewer'
  /** Every request to a deployment origin, chosen by host, not by path. */
  | 'content'

// The editing page asks for the article beside its box after every pause in
// typing, far more often than a page is opened; it is counted like the
// viewer's reads, not with the owner pages.
const ARTICLE_RENDER = /^\/my\/slides\/[^/]+\/article\/render\/?$/

const DECK_UPLOAD_START = /^\/api\/slides\/[^/]+\/uploads\/?$/

export function limitGroupOf(path: string): LimitGroup | null {
  if (path === '/auth' || path.startsWith('/auth/')) return 'auth'
  if (
    path === '/login' ||
    path.startsWith('/login/') ||
    path === '/welcome' ||
    path.startsWith('/welcome/')
  )
    return 'auth'
  if (path === '/api/uploads' || path.startsWith('/api/uploads/'))
    return 'uploads'
  if (DECK_UPLOAD_START.test(path)) return 'uploads'
  if (ARTICLE_RENDER.test(path)) return 'viewer'
  // The top page, its list of recent decks and their covers are read like
  // a share URL.
  if (
    path === '/' ||
    path === '/start' ||
    // Every page with the header asks it, readers' pages among them.
    path === '/api/session' ||
    // The top page asks it for every visitor, signed in or not; counted
    // with owner pages, readers at one venue would lock its authors out.
    path === '/api/home' ||
    path === '/api/home/communities' ||
    path.startsWith('/api/public/') ||
    path.startsWith('/covers/')
  )
    return 'viewer'
  if (
    path.startsWith('/api/') ||
    // Every page an author manages their own things on: their slides and
    // their communities.
    path === '/my' ||
    path.startsWith('/my/') ||
    path === '/settings' ||
    path.startsWith('/account/') ||
    path === '/follows' ||
    path.startsWith('/follows/') ||
    // Following a community writes D1 like following a person.
    path === '/communities/follows' ||
    path.startsWith('/communities/follows/') ||
    path === '/mutes' ||
    path.startsWith('/mutes/') ||
    path === '/blocks' ||
    path.startsWith('/blocks/') ||
    path === '/notifications' ||
    path.startsWith('/notifications/') ||
    // Reporting reads and writes D1 for a signed-in reader.
    path === '/reports' ||
    path.startsWith('/reports/')
  )
    return 'management'
  // The page a site frames, and the answer about how to frame it, are read
  // like the share URL they are about.
  if (
    path.startsWith('/@') ||
    path.toLowerCase().startsWith('/%40') ||
    path.startsWith('/embed/') ||
    path === '/oembed'
  )
    return 'viewer'
  return null
}

/**
 * The key a client is counted under. An IPv6 client usually controls a whole
 * /64, so it is counted per /64 rather than per address.
 */
export function clientKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const last = ip.slice(ip.lastIndexOf(':') + 1)
  // An IPv4-mapped address is the IPv4 client itself.
  if (last.includes('.')) return last
  const [head = '', tail = ''] = ip.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const zeros = ip.includes('::')
    ? Array(Math.max(0, 8 - left.length - right.length)).fill('0')
    : []
  const groups = [...left, ...zeros, ...right].slice(0, 4)
  return `${groups.map((group) => group.padStart(4, '0')).join(':')}::/64`
}

/** Seconds a refused client should wait; the binding counts per minute. */
export const RETRY_AFTER_SECONDS = 60
