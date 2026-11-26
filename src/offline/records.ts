import { OFFLINE_MAX_VERSIONS } from './limits'
import { isFresh } from './policy'
import { parseSharePath } from '../share/path'

/** One version the viewer has opened: where its shell is kept, when, and which origin holds the files. */
export type ViewerRecord = Readonly<{
  key: string
  storedAt: number
  origin: string
}>

/**
 * The key of a share path's record: the deck's own path, whatever page of it
 * is asked for, or null when the path is not a deck's.
 */
export function recordPath(pathname: string): string | null {
  const path = parseSharePath(pathname)
  return path.kind === 'deck' || path.kind === 'page'
    ? `/@${path.handle}/${path.slug}`
    : null
}

export type Prune = Readonly<{
  keep: readonly ViewerRecord[]
  /** Records that may no longer be shown: past a day, or beyond the 20 most recently opened. */
  evict: readonly ViewerRecord[]
}>

/**
 * Decides what the viewer keeps (D-94, F37-AC10, AC11): nothing older than a
 * day, and at most 20 versions, the most recently opened first. Two records
 * opened at the same time keep the one with the smaller key, so the result
 * does not depend on the order they were read in.
 */
export function planPrune(
  records: readonly ViewerRecord[],
  now: number,
): Prune {
  const fresh = records.filter((record) => isFresh(record.storedAt, now))
  const stale = records.filter((record) => !isFresh(record.storedAt, now))
  const ordered = [...fresh].sort(
    (a, b) => b.storedAt - a.storedAt || (a.key < b.key ? -1 : 1),
  )
  return {
    keep: ordered.slice(0, OFFLINE_MAX_VERSIONS),
    evict: [...stale, ...ordered.slice(OFFLINE_MAX_VERSIONS)],
  }
}

/** The key under which a version's origin waits to be cleared. */
export const evictKey = (managementOrigin: string, versionOrigin: string) =>
  `${managementOrigin}/_offline/evict/${encodeURIComponent(versionOrigin)}`

/** The origin a key of the list of versions to clear names, or null for anything else. */
export function evictedOrigin(
  managementOrigin: string,
  key: string,
): string | null {
  const prefix = `${managementOrigin}/_offline/evict/`
  if (!key.startsWith(prefix)) return null
  try {
    return decodeURIComponent(key.slice(prefix.length))
  } catch {
    return null
  }
}
