// Authors for the upload script on a local Worker: the rows that sign each
// one in, and the cookie to send. Pure: the caller writes the SQL to its
// local D1 (see make-local-authors.mjs). A Worker checks a cookie's signature
// with its own BETTER_AUTH_SECRET, so these open nothing whose secret is
// unknown, and nothing here touches a deployed environment.
import { ownerSessionSql, signOwnerCookie } from '../owner-cookie.mjs'

/** The most authors made at once; the upload script needs 50. */
export const MOST_AUTHORS = 200

/**
 * @param {{ count: number, secret: string, now: number, token: (index: number) => string }} options
 * @returns {{ sql: string, cookies: string[] }}
 */
export function localAuthors({ count, secret, now, token }) {
  if (!Number.isInteger(count) || count < 1 || count > MOST_AUTHORS)
    throw new Error(`count is a whole number from 1 to ${MOST_AUTHORS}`)
  const statements = []
  const cookies = []
  for (let index = 1; index <= count; index++) {
    const userId = `load${index}`
    const session = token(index)
    statements.push(
      ownerSessionSql({
        userId,
        email: `${userId}@local.example`,
        name: userId,
        token: session,
        now,
      }),
      `INSERT INTO accounts (user_id,handle,created_at) VALUES ('${userId}','${userId}',${Math.floor(now / 1000)}) ON CONFLICT DO NOTHING;`,
      `INSERT INTO profiles (user_id,name) VALUES ('${userId}','${userId}') ON CONFLICT DO NOTHING;`,
    )
    cookies.push(signOwnerCookie(session, secret))
  }
  return { sql: statements.join('\n'), cookies }
}
