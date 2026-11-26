import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { usableSecret, verifyPass } from './pass-token'

/**
 * The cookie the management host keeps for an operator who came in by the
 * entrance. The `__Host-` prefix makes the browser keep it for this host alone,
 * over https only, with no other host able to set it.
 */
export const PASS_COOKIE = '__Host-slide_maintenance_pass'

/**
 * Whether the request carries a good pass for the maintenance that holds the
 * service now (D-118). False when the service has no secret to make keys from,
 * when the cookie is missing, altered, past its hour, or was made for a
 * maintenance whose secret read differently. It reads no D1.
 */
export async function hasPass(
  c: Context<{ Bindings: Env }>,
  now: number,
): Promise<boolean> {
  const { BETTER_AUTH_SECRET: secret, MAINTENANCE: held } = c.env
  if (!usableSecret(secret) || held === undefined) return false
  return verifyPass(secret, getCookie(c, PASS_COOKIE), 'pass', held, now)
}
