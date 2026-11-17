import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose'

const sets = new Map<string, JWTVerifyGetKey>()

/**
 * The signing keys of a Cloudflare Access team, fetched when a token names
 * a key not seen yet and kept between requests. Access rotates the keys, so
 * they are never copied into the configuration.
 */
export function accessKeys(issuer: string): JWTVerifyGetKey {
  let keys = sets.get(issuer)
  if (!keys) {
    keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer))
    sets.set(issuer, keys)
  }
  return keys
}
