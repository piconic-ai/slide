import {
  isHandledRequest,
  isTopPagePath,
  STORED_AT_HEADER,
  STORED_AT_PLACEHOLDER,
  storedAtLine,
} from './limits'
import { isFresh, versionOutcomeOf } from './policy'

/** The part of Cache a version's worker uses. */
export type CacheLike = Readonly<{
  match(
    key: string,
    options?: { ignoreVary?: boolean },
  ): Promise<Response | undefined>
  put(key: string, response: Response): Promise<void>
  delete(key: string): Promise<boolean>
}>

/** What a version's worker needs from the browser, so the decisions can be tried without one. */
export type VersionWorkerDeps = Readonly<{
  /** Asks the service. */
  ask(request: Request): Promise<Response>
  openCache(): Promise<CacheLike>
  /** Drops every stored file of this version. */
  deleteCache(): Promise<void>
  now(): number
  /** The version's own origin. */
  origin: string
  waitUntil(work: Promise<unknown>): void
}>

/**
 * Counts the times this worker dropped the version. A file that was fetched
 * before a drop must not be written after it: the answer that withdrew the
 * version is the later word.
 */
let drops = 0

/** The key of a stored file: its address without the fragment, which the server never sees. */
const keyOf = (url: string) => {
  const key = new URL(url)
  key.hash = ''
  return key.href
}

/** A copy of an answer carrying when it was fetched, without the headers of its encoding. */
function stamped(answer: Response, body: BodyInit | null, at: number) {
  const headers = new Headers(answer.headers)
  headers.delete('Content-Length')
  headers.delete('Content-Encoding')
  headers.set(STORED_AT_HEADER, String(at))
  return new Response(body, {
    status: answer.status,
    statusText: answer.statusText,
    headers,
  })
}

/**
 * Keeps an answer of the service. The top page is kept only with the marker
 * the page script is told by: a copy that could not tell the viewer it is
 * stored must not be shown (F37, "伝わらないときは見せない").
 */
async function keep(
  deps: VersionWorkerDeps,
  request: Request,
  answer: Response,
  /** The count of drops when the file was asked for. */
  seen: number,
): Promise<boolean> {
  const at = deps.now()
  const url = new URL(request.url)
  let body: BodyInit | null = answer.body
  if (isTopPagePath(url.pathname)) {
    const text = await answer.text()
    if (!text.includes(STORED_AT_PLACEHOLDER)) return false
    body = text
  }
  const cache = await deps.openCache()
  if (drops !== seen) return false
  await cache.put(keyOf(request.url), stamped(answer, body, at))
  // A drop that came while it was being written takes it back out.
  if (drops !== seen) {
    await cache.delete(keyOf(request.url))
    return false
  }
  return true
}

/** Drops every stored file of the version, and the files still being written. */
async function drop(deps: VersionWorkerDeps) {
  drops += 1
  await deps.deleteCache()
}

/** The stored copy of a request, if there is one that may still be shown. */
async function storedCopy(
  deps: VersionWorkerDeps,
  request: Request,
  destination: string,
): Promise<Response | null> {
  // The top page is shown from the disk only in the viewer's frame, which can
  // be told that it is a stored copy; opened by itself it is not shown.
  if (isTopPagePath(new URL(request.url).pathname) && destination !== 'iframe')
    return null
  const cache = await deps.openCache()
  const key = keyOf(request.url)
  const entry = await cache.match(key, { ignoreVary: true })
  if (!entry) return null
  const at = Number(entry.headers.get(STORED_AT_HEADER))
  if (!isFresh(at, deps.now())) {
    await cache.delete(key)
    return null
  }
  if (!isTopPagePath(new URL(request.url).pathname)) return entry
  // The top page tells the viewer that it is a stored copy, by its time.
  const text = await entry.text()
  const parts = text.split(STORED_AT_PLACEHOLDER)
  if (parts.length !== 2) return null
  return stamped(entry, parts.join(storedAtLine(at)), at)
}

/** The facts of an answer, for deciding what to do with it. */
const factsOf = (answer: Response) => ({
  status: answer.status,
  cacheControl: answer.headers.get('Cache-Control'),
  type: answer.type,
  redirected: answer.redirected,
})

/**
 * Answers a request of a version's origin (D-91 to D-93): the service first,
 * always. What it sends is shown and kept. A version it withdraws, by the
 * answer for its top page, is dropped from the disk. Only when it does not
 * answer (no connection, 429, 5xx) is a stored copy that is not a day old
 * shown, and when there is none, what the service sent, or the browser's own
 * failure, is. `destination` is how the request was made (`iframe` for the
 * viewer's frame).
 */
export async function respond(
  deps: VersionWorkerDeps,
  request: Request,
  preload?: Promise<Response | undefined>,
  destination: string = request.destination,
): Promise<Response> {
  const seen = drops
  let answer: Response
  try {
    answer =
      (await preload?.catch(() => undefined)) ?? (await deps.ask(request))
  } catch {
    return (
      (await storedCopy(deps, request, destination).catch(() => null)) ??
      Response.error()
    )
  }
  const top = isTopPagePath(new URL(request.url).pathname)
  const outcome = versionOutcomeOf(factsOf(answer), top)
  if (outcome === 'store')
    deps.waitUntil(keep(deps, request, answer.clone(), seen).catch(() => {}))
  else if (outcome === 'purge') deps.waitUntil(drop(deps).catch(() => {}))
  else if (outcome === 'fallback')
    return (
      (await storedCopy(deps, request, destination).catch(() => null)) ?? answer
    )
  return answer
}

/** How many files are fetched at the same time when the viewer asks to keep a version. */
const PARALLEL = 6

/** What came of asking to keep the files: how many were kept, how many could not be. */
export type KeepResult = Readonly<{ kept: number; failed: number }>

/**
 * Keeps the files a frame has loaded, which were not seen by this worker
 * because it was not yet in charge. The service decides for each, as it does
 * when it is asked in the usual way. A file that the service gave but that
 * could not be kept (the disk is full), or that could not be fetched, counts
 * as failed: the version is then not whole on the disk.
 */
export async function keepFiles(
  deps: VersionWorkerDeps,
  urls: readonly string[],
): Promise<KeepResult> {
  const wanted = [...new Set(urls.map(keyOf))].filter((url) =>
    isHandledRequest({ method: 'GET', url }, deps.origin),
  )
  const result = { kept: 0, failed: 0 }
  const fetchOne = async (url: string) => {
    const seen = drops
    try {
      const request = new Request(url, { cache: 'no-cache' })
      const answer = await deps.ask(request)
      const top = isTopPagePath(new URL(url).pathname)
      const outcome = versionOutcomeOf(factsOf(answer), top)
      if (outcome === 'store') {
        if (await keep(deps, request, answer, seen)) result.kept += 1
      } else if (outcome === 'purge') await drop(deps)
    } catch {
      result.failed += 1
    }
  }
  for (let at = 0; at < wanted.length; at += PARALLEL)
    await Promise.all(wanted.slice(at, at + PARALLEL).map(fetchOne))
  return result
}
