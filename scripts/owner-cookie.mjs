// A signed-in author for a local Worker: the rows of a session, and the
// cookie Better Auth would have set for it. Pure: the caller writes the SQL
// to its local D1 and sends the cookie. A Worker checks the signature with
// its own BETTER_AUTH_SECRET, so this opens nothing whose secret is unknown.
import { createHmac } from 'node:crypto'

export const OWNER_COOKIE_NAME = '__Host-slide_owner'
/** How long the session lasts, as the Worker's own sessions do. */
const SESSION_MILLISECONDS = 12 * 60 * 60 * 1000

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`

/**
 * SQL that signs the GitHub user in: their auth user and GitHub account if
 * missing, and a session with this token. Someone who signed in through
 * GitHub before keeps the user they have. A person has one session, so a
 * new one replaces the last.
 */
export function ownerSessionSql({ githubId, name, token, now }) {
  if (!/^[1-9]\d*$/.test(String(githubId)))
    throw new Error('githubId must be a GitHub user ID')
  if (!/^[A-Za-z0-9]{16,64}$/.test(String(token)))
    throw new Error('token must be 16 to 64 letters and digits')
  if (!Number.isSafeInteger(now)) throw new Error('now must be milliseconds')
  const user = `local-user-${githubId}`
  return `INSERT INTO auth_user (id,name,email,email_verified,created_at,updated_at)
  VALUES (${quote(user)},${quote(name)},${quote(`${githubId}@users.noreply.github.com`)},0,${now},${now})
  ON CONFLICT DO NOTHING;
INSERT INTO auth_account (id,account_id,provider_id,user_id,created_at,updated_at)
  VALUES (${quote(`local-account-${githubId}`)},${quote(githubId)},'github',${quote(user)},${now},${now})
  ON CONFLICT DO NOTHING;
INSERT INTO auth_session (id,token,user_id,expires_at,created_at,updated_at)
  SELECT ${quote(`local-${token}`)},${quote(token)},user_id,${now + SESSION_MILLISECONDS},${now},${now}
  FROM auth_account WHERE provider_id = 'github' AND account_id = ${quote(githubId)};`
}

/** The Cookie header value for a session token, signed as Better Auth signs it. */
export function signOwnerCookie(token, secret) {
  if (typeof secret !== 'string' || secret.length < 32)
    throw new Error('secret must be the Worker’s BETTER_AUTH_SECRET')
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return `${OWNER_COOKIE_NAME}=${encodeURIComponent(`${token}.${signature}`)}`
}
