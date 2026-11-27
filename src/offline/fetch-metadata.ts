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
