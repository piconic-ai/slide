import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { isAllowedSource, sourceOf, verifyGitHubToken } from './oidc'

const audience = 'https://slide.piconic.ai'
const policy = {
  repositoryId: '1446590227',
  repositoryOwnerId: '248307881',
  actorId: '722500',
  allowedRefs: ['refs/heads/main', 'refs/heads/slides'],
}
const claims = {
  repository_id: policy.repositoryId,
  repository_owner_id: policy.repositoryOwnerId,
  actor_id: policy.actorId,
  ref: 'refs/heads/main',
  sha: 'a'.repeat(40),
  run_id: '123',
  run_attempt: '1',
  event_name: 'push',
}
describe('deck repository policy', () => {
  it('accepts the numeric repository, owner, actor and an allowed ref', () => {
    expect(
      isAllowedSource(sourceOf({ ...claims, event_name: 'push' }), policy),
    ).toBe(true)
  })
  it.each([
    { repositoryId: '1' },
    { repositoryOwnerId: '1' },
    { actorId: '1' },
    { ref: 'refs/heads/other' },
    { ref: 'refs/heads/main/extra' },
    { ref: 'refs/tags/main' },
  ])('rejects sources outside the binding: %j', (change) => {
    const source = { ...sourceOf({ ...claims, event_name: 'push' }), ...change }
    expect(isAllowedSource(source, policy)).toBe(false)
  })
})
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
  tokenAudience: string = audience,
  expiry: string | number = '5m',
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer('https://token.actions.githubusercontent.com')
    .setAudience(tokenAudience)
    .setSubject('repo:piconic-ai/slide:ref:refs/heads/main')
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime(expiry)
    .sign(privateKey)
}
it('verifies an RS256 signature and derives the commit from signed claims', async () => {
  expect((await verifyGitHubToken(await signed(), audience, keys)).sha).toBe(
    claims.sha,
  )
})
it('rejects an otherwise signed token with a different audience', async () => {
  await expect(
    verifyGitHubToken(await signed('wrong-audience'), audience, keys),
  ).rejects.toThrow()
})
it('rejects an expired signed token', async () => {
  await expect(
    verifyGitHubToken(await signed(audience, 1), audience, keys),
  ).rejects.toThrow()
})
it('rejects a token signed by another key', async () => {
  const other = await generateKeyPair('RS256')
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .sign(other.privateKey)
  await expect(verifyGitHubToken(token, audience, keys)).rejects.toThrow()
})

it.each([
  { event_name: 'pull_request' },
  { event_name: 'pull_request_target' },
  { sha: 'caller-controlled' },
  { repository_id: 'not-numeric' },
])(
  'rejects signed claims that are not a trusted upload: %j',
  async (change) => {
    const token = await new SignJWT({ ...claims, ...change })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer('https://token.actions.githubusercontent.com')
      .setAudience(audience)
      .setSubject('repo:piconic-ai/slide:ref:refs/heads/main')
      .setIssuedAt()
      .setNotBefore('0s')
      .setExpirationTime('5m')
      .sign(privateKey)
    await expect(verifyGitHubToken(token, audience, keys)).rejects.toThrow()
  },
)
