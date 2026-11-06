/**
 * The validator of a stored file. It is weak because Cloudflare drops strong
 * ETags from responses it compresses, which left browsers unable to get 304.
 */
export const weakEtag = (sha256: string) => `W/"${sha256}"`

/**
 * Whether If-None-Match already names this file. Revalidation compares
 * weakly (RFC 9110, section 13.1.2), so `W/` and strong forms both match.
 */
export function matchesIfNoneMatch(
  header: string | undefined,
  sha256: string,
): boolean {
  if (!header) return false
  return header
    .split(',')
    .map((tag) => tag.trim())
    .some((tag) => tag === '*' || tag.replace(/^W\//, '') === `"${sha256}"`)
}
