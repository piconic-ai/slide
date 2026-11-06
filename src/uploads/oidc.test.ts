import { describe, expect, it } from 'vitest'
import { authorizeClaims } from './oidc'
const policy = {
  OIDC_AUDIENCE: 'https://slide.piconic.ai',
  GITHUB_REPOSITORY_ID: '1446590227',
  GITHUB_OWNER_ID: '248307881',
  GITHUB_ACTOR_ID: '722500',
  GITHUB_ALLOWED_REFS: 'refs/heads/main,refs/heads/f01/upload-contract',
} satisfies Parameters<typeof authorizeClaims>[1]
const claims = {
  repository_id: policy.GITHUB_REPOSITORY_ID,
  repository_owner_id: policy.GITHUB_OWNER_ID,
  actor_id: policy.GITHUB_ACTOR_ID,
  ref: 'refs/heads/main',
  sha: 'a'.repeat(40),
  run_id: '123',
  run_attempt: '1',
  event_name: 'push',
}
describe('manually configured repository policy', () => {
  it('accepts the numeric repository, owner, actor and allowed ref', () => {
    expect(authorizeClaims(claims, policy).sha).toBe(claims.sha)
  })
  it.each([
    { repository_id: '1' },
    { repository_owner_id: '1' },
    { actor_id: '1' },
    { ref: 'refs/heads/other' },
    { event_name: 'pull_request' },
    { event_name: 'pull_request_target' },
    { sha: 'caller-controlled' },
  ])('rejects claims outside the binding: %j', (change) => {
    expect(() => authorizeClaims({ ...claims, ...change }, policy)).toThrow()
  })
})

import { beforeAll } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { verifyGitHubToken } from './oidc'
let privateKey: CryptoKey
let keys: ReturnType<typeof createLocalJWKSet>
beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256' }],
  })
})
async function signed(
  audience: string = policy.OIDC_AUDIENCE,
  expiry: string | number = '5m',
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer('https://token.actions.githubusercontent.com')
    .setAudience(audience)
    .setSubject('repo:piconic-ai/slide:ref:refs/heads/main')
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime(expiry)
    .sign(privateKey)
}
it('verifies an RS256 signature and derives the commit from signed claims', async () => {
  expect((await verifyGitHubToken(await signed(), policy, keys)).sha).toBe(
    claims.sha,
  )
})
it('rejects an otherwise signed token with a different audience', async () => {
  await expect(
    verifyGitHubToken(await signed('wrong-audience'), policy, keys),
  ).rejects.toThrow()
})
it('rejects an expired signed token', async () => {
  await expect(
    verifyGitHubToken(await signed(policy.OIDC_AUDIENCE, 1), policy, keys),
  ).rejects.toThrow()
})
it('rejects a token signed by another key', async () => {
  const other = await generateKeyPair('RS256')
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .sign(other.privateKey)
  await expect(verifyGitHubToken(token, policy, keys)).rejects.toThrow()
})
