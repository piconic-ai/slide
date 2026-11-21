/**
 * The top page is one static file for everybody, yet a signed-in visitor's
 * page holds room for the new slides of the people they follow before the
 * list arrives, and a visitor who is not signed in must get none. The
 * Worker tells which it is when it serves the file, from whether the request
 * carries a session cookie at all (the cookie is not checked here, and D1 is
 * not read: a wrong guess costs one move of the page, not a wrong page). The
 * file carries "no"; a visitor with a cookie gets "yes".
 */
export const NOT_MEMBER = 'data-member="no"'
export const MEMBER = 'data-member="yes"'

/** The top page's HTML, marked for a visitor who has a session cookie or not. */
export const markViewer = (html: string, hasSession: boolean): string =>
  hasSession ? html.replace(NOT_MEMBER, MEMBER) : html
