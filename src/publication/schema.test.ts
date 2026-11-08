import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  decks,
  deployments,
  repositoryBindings,
  uploadFiles,
} from '../db/schema'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { z } from 'zod'
import { applyMigrations } from '../db/test-migrations'
import { deckUploadsApi } from '../uploads/api'
import { parseDeckPublication } from './state'

vi.mock('../uploads/oidc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../uploads/oidc')>()),
  verifyGitHubToken: vi.fn(async () => ({
    repository_id: '1446590227',
    repository_owner_id: '248307881',
    actor_id: '722500',
    ref: 'refs/heads/main',
    sha: 'a'.repeat(40),
    run_id: '1',
    run_attempt: '1',
    event_name: 'push',
  })),
}))

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await orm.batch([
    orm.delete(uploadFiles),
    orm.delete(deployments),
    orm.delete(repositoryBindings),
    orm.delete(decks),
  ])
  await orm.batch([
    orm
      .insert(decks)
      .values({ id: 'talk', owner_user_id: '722500', created_at: 1 }),
    orm.insert(repositoryBindings).values({
      deck_id: 'talk',
      repository_id: '1446590227',
      repository_owner_id: '248307881',
      repository_full_name: 'piconic-ai/slide',
      allowed_refs: '["refs/heads/main"]',
      verified_by: '722500',
      verified_at: 1,
    }),
  ])
})
afterAll(() => platform.dispose())

const readDeck = () => orm.select().from(decks).get()

test('Given a deck revision, When an upload starts, Then the deployment records it and the deck stays a draft', async () => {
  await orm.update(decks).set({ revision: 7, author_revision: 3 })
  const response = await deckUploadsApi.request(
    'http://localhost/talk/uploads',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer local-oidc-token-123456789' },
      body: JSON.stringify({
        entry: 'index.html',
        files: [{ path: 'index.html', size: 1, sha256: 'a'.repeat(64) }],
      }),
    },
    platform.env,
  )
  expect(response.status).toBe(201)
  const row = z
    .object({ start_revision: z.number(), publish_intent: z.null() })
    .parse(
      await orm
        .select({
          start_revision: deployments.start_revision,
          publish_intent: deployments.publish_intent,
        })
        .from(deployments)
        .get(),
    )
  expect(row).toEqual({ start_revision: 7, publish_intent: null })
  expect(parseDeckPublication(await readDeck()).publication).toEqual({
    kind: 'draft',
  })
})

const insertDeployment = (id: string) =>
  orm.insert(deployments).values({
    id,
    idempotency_key: id,
    inventory_digest: 'g',
    source_sha: 's',
    run_id: '1',
    run_attempt: '1',
    actor_id: '722500',
    repository_id: '1',
    owner_id: '2',
    source_ref: 'refs/heads/main',
    state: 'ready',
    total_bytes: 1,
    token_hash: 'h',
    created_at: 1,
    expires_at: 2,
    credential_expires_at: 2,
    ready_at: 1,
    deck_id: 'talk',
  })

test.each([
  ['public while paused', "paused_at = 1, public_deployment_id = 'd'"],
  ['resume target while not paused', "resume_deployment_id = 'd'"],
  ['author revision ahead', 'author_revision = 1'],
  ['negative revision', 'revision = -1'],
  ['negative author revision', 'revision = 1, author_revision = -1'],
  ['CI run without attempt', 'ci_run_id = 1'],
  ['CI attempt without run', 'ci_run_attempt = 1'],
  ['CI attempt zero', 'ci_run_id = 1, ci_run_attempt = 0'],
  ['negative CI run', 'ci_run_id = -1, ci_run_attempt = 1'],
  ['unknown mode', "publication_mode = 'auto'"],
])(
  'Given %s, When stored, Then a CHECK constraint rejects it',
  async (_, assignment) => {
    await insertDeployment('d')
    await expect(
      orm.run(sql`UPDATE decks SET ${sql.raw(assignment)}`),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringMatching(/CHECK constraint failed/),
      }),
    })
  },
)

test('Given an unknown deployment, When pointed to, Then the foreign key rejects it', async () => {
  await orm.run(sql`PRAGMA foreign_keys = ON`)
  await expect(
    orm.update(decks).set({ public_deployment_id: 'missing' }),
  ).rejects.toMatchObject({
    cause: expect.objectContaining({
      message: expect.stringMatching(/FOREIGN KEY constraint failed/),
    }),
  })
})

test('Given an unknown publish intent, When stored, Then a CHECK constraint rejects it', async () => {
  await insertDeployment('d')
  await expect(
    orm.run(sql`UPDATE deployments SET publish_intent = 'x'`),
  ).rejects.toMatchObject({
    cause: expect.objectContaining({
      message: expect.stringMatching(/CHECK constraint failed/),
    }),
  })
})
