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

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM upload_files'),
    db.prepare('DELETE FROM deployments'),
    db.prepare('DELETE FROM repository_bindings'),
    db.prepare('DELETE FROM decks'),
  ])
  await db.batch([
    db.prepare(
      "INSERT INTO decks (id, owner_user_id, created_at) VALUES ('talk', '722500', 1)",
    ),
    db.prepare(
      `INSERT INTO repository_bindings VALUES ('talk', '1446590227', '248307881', 'piconic-ai/slide', '["refs/heads/main"]', '722500', 1)`,
    ),
  ])
})
afterAll(() => platform.dispose())

const readDeck = () =>
  db
    .prepare(
      'SELECT publication_mode, paused_at, public_deployment_id, resume_deployment_id, revision, author_revision, ci_run_id, ci_run_attempt FROM decks',
    )
    .first()

test('Given an existing deck, When migrated, Then it is a manual draft at revision 0', async () => {
  expect(parseDeckPublication(await readDeck())).toEqual({
    mode: 'manual',
    publication: { kind: 'draft' },
    revision: 0,
    authorRevision: 0,
    lastCiRun: null,
  })
})

test('Given a deck revision, When an upload starts, Then the deployment records it and the deck stays a draft', async () => {
  await db.prepare('UPDATE decks SET revision = 7, author_revision = 3').run()
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
      await db
        .prepare('SELECT start_revision, publish_intent FROM deployments')
        .first(),
    )
  expect(row).toEqual({ start_revision: 7, publish_intent: null })
  expect(parseDeckPublication(await readDeck()).publication).toEqual({
    kind: 'draft',
  })
})

test.each([
  ['public while paused', "paused_at = 1, public_deployment_id = 'd'"],
  ['resume target while not paused', "resume_deployment_id = 'd'"],
  ['author revision ahead', 'author_revision = 1'],
  ['CI run without attempt', 'ci_run_id = 1'],
  ['unknown mode', "publication_mode = 'auto'"],
])(
  'Given %s, When stored, Then the database rejects it',
  async (_, assignment) => {
    await db
      .prepare(
        `INSERT INTO deployments (id, idempotency_key, inventory_digest, source_sha, run_id, run_attempt, actor_id, repository_id, owner_id, source_ref, state, total_bytes, token_hash, created_at, expires_at, credential_expires_at, ready_at, deck_id)
         VALUES ('d', 'k', 'g', 's', '1', '1', '722500', '1', '2', 'refs/heads/main', 'ready', 1, 'h', 1, 2, 2, 1, 'talk')`,
      )
      .run()
    await expect(
      db.prepare(`UPDATE decks SET ${assignment}`).run(),
    ).rejects.toThrow()
  },
)
