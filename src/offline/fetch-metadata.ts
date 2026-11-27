/**
 * Whether an eviction page may answer a request, going by the request's
 * Fetch Metadata. The pages clear a reader's stored versions, so opening one
 * by a link or typing it must do nothing: it answers a frame only. A browser
 * that sends no metadata is answered as before (nothing here can be told).
 * `sites` are the `Sec-Fetch-Site` values the page may be framed from, or
 * null for any: the version's page is framed from the management origin, a
 * site of its own.
 */
export function mayAnswerEviction(
  request: Readonly<{ dest: string | undefined; site: string | undefined }>,
  sites: readonly string[] | null,
): boolean {
  if (request.dest !== undefined && request.dest !== 'iframe') return false
  if (sites && request.site !== undefined && !sites.includes(request.site))
    return false
  return true
}

/**
 * What a request was made for: its `Sec-Fetch-Dest`, or, for a navigation the
 * viewer's worker asked the service for, what the worker says the navigation
 * was for. The worker is only believed where a worker's own request is the
 * one that can carry the header: `empty`, from the same origin. Another site
 * cannot send it with the reader's cookie (it is not a safelisted header),
 * and only a document is named: nothing else is answered differently.
 */
export function destinationOf(
  request: Readonly<{
    dest: string | undefined
    site: string | undefined
    replayed: string | undefined
  }>,
): string | undefined {
  const fromWorker =
    request.dest === 'empty' &&
    request.site === 'same-origin' &&
    request.replayed === 'document'
  return fromWorker ? 'document' : request.dest
}
