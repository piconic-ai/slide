/**
 * Request groups with their own per-IP rate limit. Uploads from CI send one
 * request per file, so they get a separate, larger budget than owner pages.
 * Readers of a talk often share one venue's address, so share URLs get a
 * large budget of their own.
 */
export type LimitGroup = 'auth' | 'uploads' | 'management' | 'viewer'

const DECK_UPLOAD_START = /^\/api\/decks\/[^/]+\/uploads\/?$/

export function limitGroupOf(path: string): LimitGroup | null {
  if (path === '/auth' || path.startsWith('/auth/')) return 'auth'
  if (path === '/api/uploads' || path.startsWith('/api/uploads/'))
    return 'uploads'
  if (DECK_UPLOAD_START.test(path)) return 'uploads'
  if (
    path.startsWith('/api/') ||
    path === '/decks' ||
    path.startsWith('/decks/') ||
    path.startsWith('/account/')
  )
    return 'management'
  if (path.startsWith('/@') || path.toLowerCase().startsWith('/%40'))
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
