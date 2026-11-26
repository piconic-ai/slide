// What the offline reading of a version agrees on, in the places that never
// meet: the version's worker, the viewer's script, and the service's routes.
// See docs/dev/f37-offline-reading.md.

/** How long a stored version may be shown, counted from the last time the service answered for it (D-94). */
export const OFFLINE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** How many versions are kept, the most recently opened first (D-94). */
export const OFFLINE_MAX_VERSIONS = 20

/**
 * Paths under `_preview/`, which a version's origin never serves from the
 * author's files (see requestedFile), so no author file can hide them.
 */
export const VERSION_WORKER_PATH = '/_preview/sw.js'
export const FRAME_SCRIPT_PATH = '/_preview/offline.js'
export const EVICT_PATH = '/_preview/evict'

/** Built files of this directory, served from the management origin's assets. */
export const WORKER_ASSET_PATH = '/offline-sw.js'
export const CLIENT_ASSET_PATH = '/offline-client.js'

/** The header that carries when a stored response was last fetched (ms since the epoch). */
export const STORED_AT_HEADER = 'X-Slide-Stored-At'

/** The version origin's cache. One version has one origin, so it holds one version. */
export const VERSION_CACHE = 'slide-offline-version'

/**
 * The marker in the page script that the version's worker replaces with the
 * time of the copy it serves, so the page tells the viewer it is stored.
 */
export const STORED_AT_MARK = 'slide-stored-at'

/** How the page script spells it: with no time (0), as the service serves it. */
export const STORED_AT_PLACEHOLDER = `const storedAt = 0 /*${STORED_AT_MARK}*/`

/** The same line with the time a copy was fetched at. */
export const storedAtLine = (storedAt: number) =>
  `const storedAt = ${Math.trunc(storedAt)} /*${STORED_AT_MARK}*/`

/** Messages between a version's frame and the viewer; the viewer's origin is the only one told. */
export const OFFLINE_MESSAGE = {
  /** The viewer asks the frame to register its worker and keep the version. */
  register: 'slide:offline-register',
  /** The frame answers what became of it. */
  state: 'slide:offline-state',
  /** The frame shows a stored copy. */
  stored: 'slide:stored',
  /** The eviction page has cleared its origin. */
  evicted: 'slide:offline-evicted',
} as const

/** What a frame asks its own worker: keep these files, which loaded before it was in charge. */
export const KEEP_MESSAGE = 'slide:offline-keep'

/** What a frame tells the viewer about keeping its version. */
export type OfflineState = 'stored' | 'unsupported'

/** The top page of a version, whose copy carries the page script. */
export const isTopPagePath = (pathname: string) =>
  pathname === '/' || pathname === '/index.html'

/** Whether a worker of a version's origin answers a request at all. */
export function isHandledRequest(
  request: Readonly<{ method: string; url: string }>,
  origin: string,
): boolean {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  return url.origin === origin && !url.pathname.startsWith('/_preview/')
}
