/**
 * The top page is one static file for everybody, yet a signed-in visitor's
 * place to drop slides starts small, and a visitor who is not signed in
 * gets the large one. The Worker tells which it is when it serves the file,
 * from whether the request carries a session cookie at all (the cookie is
 * not checked for this mark, and a wrong guess costs one move of the page,
 * not a wrong page). The file carries "no"; a visitor with a cookie gets
 * "yes".
 */
export const NOT_MEMBER = 'data-member="no"'
export const MEMBER = 'data-member="yes"'

/** What the Worker learned of the visitor: a session cookie or none. */
export type HomeViewer =
  | Readonly<{ kind: 'visitor' }>
  | Readonly<{ kind: 'member' }>

/** The top page's HTML, marked for what is known of its visitor. */
export const markViewer = (html: string, viewer: HomeViewer): string =>
  viewer.kind === 'visitor' ? html : html.replace(NOT_MEMBER, MEMBER)
