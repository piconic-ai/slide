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
 * SQL that signs a person in without the login page: their auth user if
 * missing, the invitation for their address, and a session with this token.
 * A person has one session, so a new one replaces the last. The login page
 * itself is tried by reading the code from the local outbox (see
 * scripts/local-login-code.mjs). This is for scripts that need a signed-in
 * author and have no use for the page.
 */
export function ownerSessionSql({ userId, email, name, token, now }) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(userId)))
    throw new Error('userId must be 1 to 64 letters, digits, - or _')
  if (!/^[^\s'@]+@[^\s'@]+$/.test(String(email)))
    throw new Error('email must be an address')
  if (!/^[A-Za-z0-9]{16,64}$/.test(String(token)))
    throw new Error('token must be 16 to 64 letters and digits')
  if (!Number.isSafeInteger(now)) throw new Error('now must be milliseconds')
  const address = String(email).toLowerCase()
  return `INSERT INTO auth_user (id,name,email,email_verified,created_at,updated_at)
  VALUES (${quote(userId)},${quote(name)},${quote(address)},1,${now},${now})
  ON CONFLICT DO NOTHING;
INSERT INTO invited_emails (email,invited_at,invited_by)
  VALUES (${quote(address)},${Math.floor(now / 1000)},'local-script')
  ON CONFLICT DO NOTHING;
DELETE FROM auth_session WHERE user_id = ${quote(userId)};
INSERT INTO auth_session (id,token,user_id,expires_at,created_at,updated_at)
  VALUES (${quote(`local-${token}`)},${quote(token)},${quote(userId)},${now + SESSION_MILLISECONDS},${now},${now});`
}

/** The Cookie header value for a session token, signed as Better Auth signs it. */
export function signOwnerCookie(token, secret) {
  if (typeof secret !== 'string' || secret.length < 32)
    throw new Error('secret must be the Worker’s BETTER_AUTH_SECRET')
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return `${OWNER_COOKIE_NAME}=${encodeURIComponent(`${token}.${signature}`)}`
}
