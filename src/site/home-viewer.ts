/**
 * The top page is one static file for everybody, yet a signed-in visitor's
 * page holds room for the new slides of the people they follow before the
 * list arrives, and a visitor who is not signed in must get none. The
 * Worker tells which it is when it serves the file, from whether the request
 * carries a session cookie at all (the cookie is not checked for this mark,
 * and a wrong guess costs one move of the page, not a wrong page). The file
 * carries "no"; a visitor with a cookie gets "yes".
 *
 * The room for the new slides of followed communities is held only for a
 * visitor who follows one (F31-AC6, F31-AC16). The Worker reads that from
 * D1 for a visitor whose session holds, and marks the page with a second
 * attribute; the file carries "no" there too.
 */
export const NOT_MEMBER = 'data-member="no"'
export const MEMBER = 'data-member="yes"'
export const NO_COMMUNITIES = 'data-communities="no"'
export const COMMUNITIES = 'data-communities="yes"'

/**
 * What the Worker learned of the visitor before serving the top page: no
 * session cookie, or one, with whether its session holds and follows a
 * community.
 */
export type HomeViewer =
  | Readonly<{ kind: 'visitor' }>
  | Readonly<{ kind: 'member'; followsCommunity: boolean }>

/** The top page's HTML, marked for what is known of its visitor. */
export const markViewer = (html: string, viewer: HomeViewer): string => {
  if (viewer.kind === 'visitor') return html
  const member = html.replace(NOT_MEMBER, MEMBER)
  return viewer.followsCommunity
    ? member.replace(NO_COMMUNITIES, COMMUNITIES)
    : member
}
