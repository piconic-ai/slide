// The viewer's list of the decks it keeps (D-94): which shell is kept, from
// when, for which version, and which versions wait to be cleared. The page
// reaches the browser's Cache Storage and the clearing frames through the
// deps, so the order of these steps is tested without a browser.
import {
  CONTENT_ORIGIN_HEADER,
  EVICT_CACHE,
  isVersionOrigin,
  STORED_AT_HEADER,
  VIEWER_CACHE,
} from './limits'
import { serialQueue } from './serial-queue'
import {
  evictedOrigin,
  evictKey,
  planPrune,
  type ViewerRecord,
} from './records'

/** The part of a Cache the list uses, by address. */
export type ShellCache = Readonly<{
  keys: () => Promise<readonly { url: string }[]>
  match: (key: string) => Promise<Response | undefined>
  put: (key: string, response: Response) => Promise<void>
  delete: (key: string) => Promise<unknown>
}>

export type ShellDeps = Readonly<{
  /** The management origin, which the list is kept under. */
  managementOrigin: string
  /** The content domain the service is set to, which every origin is held to. */
  contentBase: string
  now: () => number
  openCache: (name: string) => Promise<ShellCache>
  /** Clears a version's files through a frame of its origin; false when it could not be reached. */
  clearVersion: (origin: string) => Promise<boolean>
}>

async function recordsOf(cache: ShellCache): Promise<ViewerRecord[]> {
  const records: ViewerRecord[] = []
  for (const request of await cache.keys()) {
    const entry = await cache.match(request.url)
    records.push({
      key: request.url,
      storedAt: Number(entry?.headers.get(STORED_AT_HEADER)),
      origin: entry?.headers.get(CONTENT_ORIGIN_HEADER) ?? '',
    })
  }
  return records
}

/** Puts a version's origin on the list to clear. */
async function queueClearing(deps: ShellDeps, origin: string) {
  const evictions = await deps.openCache(EVICT_CACHE)
  await evictions.put(
    evictKey(deps.managementOrigin, origin),
    new Response('', { headers: { [STORED_AT_HEADER]: String(deps.now()) } }),
  )
}

/**
 * Drops what may no longer be shown (a day passed, beyond 20 versions), puts
 * those versions' origins on the list to clear, and clears every origin on
 * the list that is not one still kept. `current` is the version the page
 * shows: it is never cleared, whatever an old record of it says, because its
 * frame is storing it now. A version it cannot reach now (no connection)
 * stays on the list for the next time.
 */
async function pruneNow(deps: ShellDeps, current: string) {
  const viewers = await deps.openCache(VIEWER_CACHE)
  const evictions = await deps.openCache(EVICT_CACHE)
  const { keep, evict } = planPrune(await recordsOf(viewers), deps.now())
  for (const record of evict) {
    if (
      record.origin !== current &&
      isVersionOrigin(record.origin, deps.contentBase)
    )
      await queueClearing(deps, record.origin)
    await viewers.delete(record.key)
  }
  const stillKept = new Set([current, ...keep.map((record) => record.origin)])
  for (const request of await evictions.keys()) {
    const origin = evictedOrigin(deps.managementOrigin, request.url)
    if (
      origin === null ||
      !isVersionOrigin(origin, deps.contentBase) ||
      stillKept.has(origin)
    ) {
      await evictions.delete(request.url)
    } else if (await deps.clearVersion(origin))
      await evictions.delete(request.url)
  }
}

/** Writes the shell of a deck for the version its frame has kept; the version it had before goes on the list to clear. */
async function keepNow(
  deps: ShellDeps,
  shell: string,
  path: string,
  origin: string,
) {
  const viewers = await deps.openCache(VIEWER_CACHE)
  const key = `${deps.managementOrigin}${path}`
  const before = await viewers.match(key)
  await viewers.put(
    key,
    new Response(shell, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        [STORED_AT_HEADER]: String(deps.now()),
        [CONTENT_ORIGIN_HEADER]: origin,
      },
    }),
  )
  // The deck now has another version: the one it had is no longer wanted.
  const previous = before?.headers.get(CONTENT_ORIGIN_HEADER)
  if (
    previous &&
    previous !== origin &&
    isVersionOrigin(previous, deps.contentBase)
  )
    await queueClearing(deps, previous)
}

/**
 * The list for one viewer page, whose deck is shown from the version `current`.
 * Its two steps, writing a shell and pruning, go through one queue and run one
 * at a time: a prune decides from what it read, so a shell written between its
 * reading and its deleting would be deleted by a decision about the record it
 * replaced (F37-AC22).
 */
export function shellKeeper(deps: ShellDeps, current: string) {
  const inOrder = serialQueue()
  return {
    /** Writes the shell, then prunes, as one step. */
    keep: (shell: string, path: string, origin: string) =>
      inOrder(async () => {
        await keepNow(deps, shell, path, origin)
        await pruneNow(deps, current)
      }),
    prune: () => inOrder(() => pruneNow(deps, current)),
  }
}
