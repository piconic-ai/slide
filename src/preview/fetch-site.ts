/**
 * Whether a request may be answered with the owner's session.
 *
 * Every deployment has its own origin, but all of them share one registrable
 * domain, and the session cookie of the viewer's frame is kept for the whole
 * of the site that holds the frame, so the browser sends it on requests
 * another deployment's page makes to this one. Such a page must not get
 * owner-only files: as a script they would run inside it. The session
 * therefore counts only for the deployment's own requests: its page loading
 * its files, and the frame moving itself to the slides after the launch
 * (see launchedFrame). No move into a frame from outside counts, however it
 * came, and neither does a top-level move: the session belongs to the
 * viewer's frame and nothing else.
 *
 * A request without the header comes from a client that is not a current
 * browser; it is answered as before.
 */
export function ownerSessionApplies(site: string | undefined): boolean {
  return site === undefined || site === 'same-origin'
}
