import { jwtVerify, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'
import type { AccessConfig } from './config'

/** The header Cloudflare Access adds to a request it let through. */
export const ACCESS_TOKEN_HEADER = 'Cf-Access-Jwt-Assertion'

/** A person Cloudflare Access verified and the application's policy allows. */
export type Operator = Readonly<{ email: string }>

export type AccessResult =
  | Readonly<{ kind: 'operator'; operator: Operator }>
  | Readonly<{ kind: 'denied'; reason: string }>

// The takedown record stores the email; see OPERATOR_MAX.
const emailSchema = z.email().max(320)

/**
 * Verifies the token Cloudflare Access attached to a request: its signature
 * against the team's keys, its issuer, its audience, and its lifetime at
 * `now`. A token without a person's email, such as a service token's, is
 * denied: every operator action records who took it.
 */
export async function verifyAccessToken(
  token: string | undefined,
  access: AccessConfig,
  keys: JWTVerifyGetKey,
  now: number,
): Promise<AccessResult> {
  if (!token) return { kind: 'denied', reason: 'no_token' }
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: access.issuer,
      audience: access.audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp'],
      currentDate: new Date(now * 1000),
    })
    const email = emailSchema.safeParse(payload.email)
    return email.success
      ? { kind: 'operator', operator: { email: email.data } }
      : { kind: 'denied', reason: 'no_email' }
  } catch (error) {
    return {
      kind: 'denied',
      reason:
        error instanceof Error && 'code' in error
          ? String(error.code)
          : 'unverifiable',
    }
  }
}
