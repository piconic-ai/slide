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

/** Which signed workflow identities may upload to one deck. */
export type RepositoryPolicy = Readonly<{
  repositoryId: string
  repositoryOwnerId: string
  actorId: string
  allowedRefs: readonly string[]
}>

/** The identity a stored deployment was created with. */
export type UploadSource = Readonly<{
  repositoryId: string
  repositoryOwnerId: string
  actorId: string
  ref: string
}>

export function sourceOf(claims: GitHubClaims): UploadSource {
  return {
    repositoryId: claims.repository_id,
    repositoryOwnerId: claims.repository_owner_id,
    actorId: claims.actor_id,
    ref: claims.ref,
  }
}

/** True when a workflow identity is still allowed by the deck's binding. */
export function isAllowedSource(
  source: UploadSource,
  policy: RepositoryPolicy,
): boolean {
  return (
    source.repositoryId === policy.repositoryId &&
    source.repositoryOwnerId === policy.repositoryOwnerId &&
    source.actorId === policy.actorId &&
    policy.allowedRefs.includes(source.ref)
  )
}

/**
 * Verifies the GitHub Actions OIDC signature, issuer, audience, and lifetime,
 * and parses the claims. Repository authorization is a separate step.
 */
export async function verifyGitHubToken(
  token: string,
  audience: string,
  keys: JWTVerifyGetKey = githubKeys,
): Promise<GitHubClaims> {
  const { payload } = await jwtVerify(token, keys, {
    issuer,
    audience,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'nbf', 'sub'],
    maxTokenAge: '10m',
  })
  return claimsSchema.parse(payload)
}
