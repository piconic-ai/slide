/**
 * Request groups with their own per-IP rate limit. Uploads from CI send one
 * request per file, so they get a separate, larger budget than owner pages.
 */
export type LimitGroup = 'auth' | 'uploads' | 'management'

const DECK_UPLOAD_START = /^\/api\/decks\/[^/]+\/uploads\/?$/

export function limitGroupOf(path: string): LimitGroup | null {
  if (path === '/auth' || path.startsWith('/auth/')) return 'auth'
  if (path === '/api/uploads' || path.startsWith('/api/uploads/'))
    return 'uploads'
  if (DECK_UPLOAD_START.test(path)) return 'uploads'
  if (
    path.startsWith('/api/') ||
    path === '/decks' ||
    path.startsWith('/decks/')
  )
    return 'management'
  return null
}

/** Seconds a refused client should wait; the binding counts per minute. */
export const RETRY_AFTER_SECONDS = 60
