/** The Fetch Metadata headers a browser attaches to a request. */
export type FetchMetadata = Readonly<{
  site: string | undefined
  mode: string | undefined
  dest: string | undefined
  /** `Sec-Purpose`, set when the browser loads a page ahead of the reader. */
  purpose: string | undefined
}>

/**
 * Whether a request may be answered with the owner's session.
 *
 * Every deployment has its own origin, but all of them share one registrable
 * domain, so a browser sends a deployment's SameSite=Lax session cookie on
 * requests another deployment's page makes to it. Such a page must not get
 * owner-only files: as a script they would run inside it. The session
 * therefore counts only for the deployment's own requests, for a request the
 * reader typed or opened themselves, and for a top-level navigation, which
 * shows the file to the owner and to nobody else. A page another deployment
 * asks the browser to load ahead of time is not the owner's doing.
 *
 * The viewer holds an owner-only deployment in a frame, so a frame the page
 * of another site opens counts too. A frame inside another deployment does
 * not: it is `same-site`. The session cookie that answers such a frame is
 * partitioned by the site that holds it, so a page on a third site has none.
 *
 * A request without the headers comes from a client that is not a current
 * browser; it is answered as before.
 */
export function ownerSessionApplies(metadata: FetchMetadata): boolean {
  const { site, mode, dest, purpose } = metadata
  if (site === undefined || site === 'same-origin' || site === 'none')
    return true
  if (mode !== 'navigate' || purpose !== undefined) return false
  return dest === 'document' || (dest === 'iframe' && site === 'cross-site')
}
