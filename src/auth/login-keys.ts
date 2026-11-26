import { clientKey } from '../site/rate-limit-policy'
import { hashToken } from './owner-session'

/**
 * What the limits on sign-in codes count by (F43-AC11): the address and the
 * source of a request, each as a hash made with the auth secret. The address
 * itself is not kept, and a hash of it cannot be checked without the secret,
 * where a plain SHA-256 or MD5 of an address can be found again by trying
 * addresses. A new secret gives new values, which only restarts the counts.
 */
export async function loginKeys(
  secret: string,
  email: string,
  ip: string | null,
) {
  return {
    addressHash: await hashToken(`login-address:${secret}:${email}`),
    sourceHash: await hashToken(
      `login-source:${secret}:${ip ? clientKey(ip) : 'local'}`,
    ),
  }
}
