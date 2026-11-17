import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import {
  decks,
  deployments,
  repositoryBindings,
  uploadFiles,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { INVITED_ID, OWNER_ID, withInvited } from '../publication/test-support'
import { deckUploadsApi, uploadsApi } from './api'

// Every workflow in this file is run by the invited author, from one
// repository that both slides are connected to.
vi.mock('./oidc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./oidc')>()),
  verifyGitHubToken: vi.fn(async () => ({
    repository_id: '1446590227',
    repository_owner_id: '248307881',
    actor_id: '1234',
    ref: 'refs/heads/main',
    sha: 'a'.repeat(40),
    run_id: '1',
    run_attempt: '1',
    event_name: 'push',
  })),
}))

const platform = await getPlatformProxy<Env>({ persist: false })
const db = drizzle(platform.env.DB)
const both = withInvited(platform.env)
const inventory = {
  entry: 'index.html',
  files: [{ path: 'index.html', size: 1, sha256: 'a'.repeat(64) }],
}
const start = (deck: string, env: Env) =>
  deckUploadsApi.request(
    `http://localhost/${deck}/uploads`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer local-oidc-token-123456789' },
      body: JSON.stringify(inventory),
    },
    env,
  )
const bind = (deck: string, owner: string) =>
  db.batch([
    db
      .insert(decks)
      .values({ id: deck, slug: deck, owner_user_id: owner, created_at: 1 }),
    db.insert(repositoryBindings).values({
      deck_id: deck,
      repository_id: '1446590227',
      repository_owner_id: '248307881',
      repository_full_name: 'piconic-ai/slide',
      allowed_refs: '["refs/heads/main"]',
      verified_by: owner,
      verified_at: 1,
    }),
  ])

beforeAll(() => applyMigrations(platform.env.DB))
beforeEach(async () => {
  await db.batch([
    db.delete(uploadFiles),
    db.delete(deployments),
    db.delete(repositoryBindings),
    db.delete(decks),
  ])
  await bind('alice-talk', OWNER_ID)
  await bind('bob-talk', INVITED_ID)
})
afterAll(() => platform.dispose())

test('F01-AC5: Given the invited author’s workflow, When it uploads to their own slide, Then the upload starts', async () => {
  const response = await start('bob-talk', both)

  expect(response.status).toBe(201)
  expect(
    await db
      .select({ deck: deployments.deck_id, actor: deployments.actor_id })
      .from(deployments),
  ).toEqual([{ deck: 'bob-talk', actor: INVITED_ID }])
})

test('F01-AC7: Given the invited author’s workflow, When it uploads to another author’s slide connected to the same repository, Then it is refused and nothing is created', async () => {
  const response = await start('alice-talk', both)

  expect(response.status).toBe(403)
  expect(await db.$count(deployments)).toBe(0)
})

test('F01-AC8: Given an author removed from the registration, When their workflow uploads to their own slide, Then it is refused', async () => {
  expect((await start('bob-talk', platform.env)).status).toBe(403)
  expect(await db.$count(deployments)).toBe(0)
})

test('F01-AC8: Given an upload the author started, When they are removed before it finishes, Then its credential stops working', async () => {
  const receipt = (await (await start('bob-talk', both)).json()) as {
    deploymentId: string
    credential: string
  }
  const read = (env: Env) =>
    uploadsApi.request(
      `http://localhost/${receipt.deploymentId}`,
      { headers: { Authorization: `Bearer ${receipt.credential}` } },
      env,
    )

  expect((await read(both)).status).toBe(200)
  expect((await read(platform.env)).status).toBe(403)
})

test.each(['', `${OWNER_ID},${INVITED_ID},`, `${INVITED_ID},${INVITED_ID}`])(
  'Given the mistaken setting %j, When a workflow uploads, Then it is refused',
  async (value) => {
    const env = { ...platform.env, AUTHOR_GITHUB_IDS: value } as unknown as Env

    expect((await start('bob-talk', env)).status).toBe(403)
  },
)
