import {
  CONTENT_ORIGIN_HEADER,
  EVICT_CACHE,
  isVersionOrigin,
  REPLAYED_DEST_HEADER,
  SHELL_SCRIPT_PATH,
  STATIC_CACHE,
  STORED_AT_HEADER,
  VIEWER_CACHE,
} from './limits'
import { isFresh, outcomeOf, shellPolicy } from './policy'
import { evictKey, isSuperseded, recordPath } from './records'
import type { CacheLike } from './version-worker'

/** What the viewer's worker needs from the browser, so its decisions can be tried without one. */
export type ViewerWorkerDeps = Readonly<{
  /** Asks the service. */
  ask(request: Request): Promise<Response>
  openCache(name: string): Promise<CacheLike>
  now(): number
  /** The management origin. */
  origin: string
  /** The origin of the content domain, which every version's origin is under. */
  contentBase: string
  waitUntil(work: Promise<unknown>): void
}>

/** A reader's move to a deck's share URL, or to a page of it: the one request this worker answers. */
export function isViewerNavigation(
  request: Readonly<{ method: string; url: string; mode: string }>,
  origin: string,
): boolean {
  if (request.method !== 'GET' || request.mode !== 'navigate') return false
  const url = new URL(request.url)
  return url.origin === origin && recordPath(url.pathname) !== null
}

/** The shell's own script, which the shell cannot run without. */
export const isShellScript = (
  request: Readonly<{ method: string; url: string }>,
  origin: string,
) => {
  const url = new URL(request.url)
  return (
    request.method === 'GET' &&
    url.origin === origin &&
    url.pathname === SHELL_SCRIPT_PATH
  )
}

/** The shell kept for a deck, when it may still be shown: not past a day, naming a real version origin. */
async function keptShell(
  deps: ViewerWorkerDeps,
  key: string,
): Promise<Response | null> {
  const cache = await deps.openCache(VIEWER_CACHE)
  const entry = await cache.match(key)
  if (!entry) return null
  const at = Number(entry.headers.get(STORED_AT_HEADER))
  const origin = entry.headers.get(CONTENT_ORIGIN_HEADER) ?? ''
  if (!isFresh(at, deps.now())) {
    // Past its day: the shell goes, and the files of its version are put on
    // the list to clear, as for a version the service withdrew.
    await forget(deps, key)
    return null
  }
  if (!isVersionOrigin(origin, deps.contentBase)) return null
  return new Response(await entry.text(), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': shellPolicy(origin),
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  })
}

/**
 * Forgets a deck the service no longer shows (F37-AC7 to AC9). Its shell is
 * dropped now, so it can never be shown again, and its version's origin is
 * put on the list the viewer clears the next time it runs: the files sit
 * under another origin that only a frame of it can reach.
 */
async function forget(deps: ViewerWorkerDeps, key: string): Promise<void> {
  const viewers = await deps.openCache(VIEWER_CACHE)
  const entry = await viewers.match(key)
  if (!entry) return
  const origin = entry.headers.get(CONTENT_ORIGIN_HEADER) ?? ''
  if (isVersionOrigin(origin, deps.contentBase)) {
    const evictions = await deps.openCache(EVICT_CACHE)
    await evictions.put(
      evictKey(deps.origin, origin),
      new Response('', { headers: { [STORED_AT_HEADER]: String(deps.now()) } }),
    )
  }
  await viewers.delete(key)
}

/**
 * Drops the shell kept for a deck when the service, answering now, shows
 * something else (F37-AC21): another version (including one that could not be
 * stored), or a view that is not kept at all, such as the author's preview.
 * The version it showed is put on the list to clear by `forget`. A deck with
 * no shell kept is left alone. A shell the viewer has just written for the
 * version shown is the same origin, so it stays (F37-AC6).
 */
async function forgetIfSuperseded(
  deps: ViewerWorkerDeps,
  key: string,
  shownOrigin: string | null,
): Promise<void> {
  const viewers = await deps.openCache(VIEWER_CACHE)
  const entry = await viewers.match(key)
  if (!entry) return
  const kept = entry.headers.get(CONTENT_ORIGIN_HEADER) ?? ''
  if (isSuperseded(kept, shownOrigin)) await forget(deps, key)
}

/**
 * The request the service is asked with for a move to a share URL. A move to
 * the page itself names what it was for (see REPLAYED_DEST_HEADER), so the
 * service answers the author as it does without a worker: with their own
 * view of a version only they may open (F02-AC18, AC29, AC36). A move inside
 * a frame is asked as it is.
 */
export function replayOf(request: Request): Request {
  if (request.destination !== 'document') return request
  const headers = new Headers(request.headers)
  headers.set(REPLAYED_DEST_HEADER, 'document')
  return new Request(request, { headers })
}

/**
 * Answers a move to a share URL (D-91 to D-93): the service first, always.
 * What it sends is shown as it is; the viewer is the service's own page, made
 * for this reader, and is never kept. Only when the service does not answer
 * (no connection, 429, 5xx) is the shell of that deck shown, if one was kept
 * and is not a day old, and when there is none, what the service sent. A deck
 * the service withdraws is forgotten, and so is one the service answers with
 * another version, or with none (F37-AC21).
 */
export async function respondViewer(
  deps: ViewerWorkerDeps,
  request: Request,
): Promise<Response> {
  const key = `${deps.origin}${recordPath(new URL(request.url).pathname)}`
  let answer: Response
  try {
    answer = await deps.ask(replayOf(request))
  } catch {
    return (await keptShell(deps, key).catch(() => null)) ?? Response.error()
  }
  const outcome = outcomeOf({
    status: answer.status,
    cacheControl: answer.headers.get('Cache-Control'),
    type: answer.type,
    redirected: answer.redirected,
  })
  if (outcome === 'purge') deps.waitUntil(forget(deps, key).catch(() => {}))
  else if (outcome === 'fallback')
    return (await keptShell(deps, key).catch(() => null)) ?? answer
  else if (answersInPlace(answer, request))
    deps.waitUntil(
      forgetIfSuperseded(
        deps,
        key,
        answer.headers.get(CONTENT_ORIGIN_HEADER),
      ).catch(() => {}),
    )
  return answer
}

/**
 * Whether a 200 is the answer for this very page, to be compared with the
 * kept shell: not one that came by a redirect, and not the small page of a
 * link a deck follows inside its own frame.
 */
const answersInPlace = (
  answer: Readonly<{ status: number; redirected: boolean }>,
  request: Readonly<{ destination: string }>,
) =>
  answer.status === 200 &&
  !answer.redirected &&
  request.destination !== 'iframe'

/** Keeps the shell's script as the service sent it, so the shell runs without a connection. */
async function keepScript(deps: ViewerWorkerDeps, answer: Response) {
  const cache = await deps.openCache(STATIC_CACHE)
  await cache.put(SHELL_SCRIPT_PATH, answer)
}

/**
 * Answers a request for the shell's script: the service's, kept, and the kept
 * copy when the service does not answer. It is the service's own file, the
 * same for everyone, so it has no day to run out.
 */
export async function respondScript(
  deps: ViewerWorkerDeps,
  request: Request,
): Promise<Response> {
  const stored = async () =>
    (await (await deps.openCache(STATIC_CACHE)).match(SHELL_SCRIPT_PATH)) ??
    null
  let answer: Response
  try {
    answer = await deps.ask(request)
  } catch {
    return (await stored().catch(() => null)) ?? Response.error()
  }
  const outcome = outcomeOf({
    status: answer.status,
    cacheControl: answer.headers.get('Cache-Control'),
    type: answer.type,
    redirected: answer.redirected,
  })
  if (outcome === 'store')
    deps.waitUntil(keepScript(deps, answer.clone()).catch(() => {}))
  else if (outcome === 'fallback')
    return (await stored().catch(() => null)) ?? answer
  return answer
}

/** Keeps the shell's script when the worker is installed. A failure leaves the worker uninstalled. */
export async function installScript(deps: ViewerWorkerDeps): Promise<void> {
  const answer = await deps.ask(
    new Request(new URL(SHELL_SCRIPT_PATH, deps.origin)),
  )
  if (!answer.ok) throw new Error('the shell script could not be kept')
  await keepScript(deps, answer)
}
