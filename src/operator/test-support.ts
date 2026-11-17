import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose'

export const TEAM = 'https://team.cloudflareaccess.com'
export const AUDIENCE = 'a'.repeat(64)
export const OPERATOR_ORIGIN = 'https://admin.slide.example'

/**
 * A stand-in for a Cloudflare Access team: a signing key, the key set a
 * verifier would fetch, and tokens signed as Access signs them. The key is
 * generated per test file, so no token made here verifies anywhere else.
 */
export async function accessTeam() {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }
  const keys: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] })
  const sign = (
    claims: JWTPayload = {},
    options: { expiresAt?: number; key?: CryptoKey; alg?: string } = {},
  ) =>
    new SignJWT({ email: 'op@example.com', ...claims })
      .setProtectedHeader({ alg: options.alg ?? 'RS256', kid: 'k1' })
      .setIssuer(typeof claims.iss === 'string' ? claims.iss : TEAM)
      .setAudience(
        typeof claims.aud === 'string' || Array.isArray(claims.aud)
          ? claims.aud
          : AUDIENCE,
      )
      .setExpirationTime(
        options.expiresAt ?? Math.floor(Date.now() / 1000) + 600,
      )
      .sign(options.key ?? privateKey)
  return { keys, sign }
}
