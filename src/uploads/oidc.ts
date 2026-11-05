import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'

const issuer = 'https://token.actions.githubusercontent.com'
const githubKeys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`))
const claimsSchema = z.object({
  repository_id: z.string().regex(/^\d+$/),
  repository_owner_id: z.string().regex(/^\d+$/),
  actor_id: z.string().regex(/^\d+$/),
  ref: z.string(),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  run_id: z.string().regex(/^\d+$/),
  run_attempt: z.string().regex(/^\d+$/),
  event_name: z.enum(['push', 'workflow_dispatch']),
})
export type GitHubClaims = z.infer<typeof claimsSchema>
export type RepositoryPolicy = Pick<Env, 'GITHUB_REPOSITORY_ID' | 'GITHUB_OWNER_ID' | 'GITHUB_ACTOR_ID' | 'GITHUB_ALLOWED_REFS' | 'OIDC_AUDIENCE'>

export function authorizeClaims(payload: unknown, policy: RepositoryPolicy): GitHubClaims {
  const claims = claimsSchema.parse(payload)
  if (claims.repository_id !== policy.GITHUB_REPOSITORY_ID ||
      claims.repository_owner_id !== policy.GITHUB_OWNER_ID ||
      claims.actor_id !== policy.GITHUB_ACTOR_ID ||
      !policy.GITHUB_ALLOWED_REFS.split(',').includes(claims.ref)) {
    throw new Error('Repository policy rejected')
  }
  return claims
}

export async function verifyGitHubToken(token: string, policy: RepositoryPolicy, keys: JWTVerifyGetKey = githubKeys) {
  const { payload } = await jwtVerify(token, keys, {
    issuer, audience: policy.OIDC_AUDIENCE, algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'nbf', 'sub'], maxTokenAge: '10m',
  })
  return authorizeClaims(payload, policy)
}
