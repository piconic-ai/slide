import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { z } from 'zod'
import { applyMigrations } from '../db/test-migrations'
import { deckUploadsApi, uploadsApi } from '../uploads/api'
import { readPublication } from './store'
import { OWNER_ID, resetTables, seedDeck } from './test-support'

const run = vi.hoisted(() => ({ id: '20', attempt: '1' }))
vi.mock('../uploads/oidc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../uploads/oidc')>()),
  verifyGitHubToken: vi.fn(async () => ({
    repository_id: '1446590227',
    repository_owner_id: '248307881',
    actor_id: OWNER_ID,
    ref: 'refs/heads/main',
    sha: 'a'.repeat(40),
    run_id: run.id,
    run_attempt: run.attempt,
    event_name: 'push',
  })),
}))

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
// Overlapping runs need more than one open session.
const env = {
  ...platform.env,
  UPLOAD_LIMITS: { activeSessions: 3 },
} as unknown as Env

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
  await db
    .prepare(
      `INSERT INTO repository_bindings VALUES ('talk', '1446590227', '248307881', 'piconic-ai/slide', '["refs/heads/main"]', ?, 1)`,
    )
    .bind(OWNER_ID)
    .run()
  await db.prepare("UPDATE decks SET publication_mode = 'repository'").run()
})
afterAll(() => platform.dispose())

const startSchema = z.object({
  deploymentId: z.string(),
  credential: z.string(),
})
const finalizeSchema = z.object({
  state: z.literal('ready'),
  publication: z.object({
    applied: z.boolean(),
    reason: z.string().optional(),
  }),
})

async function sha256(text: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** Starts an upload of a one-file deck in the current run. */
async function start(content: string, publication?: unknown) {
  const response = await deckUploadsApi.request(
    'http://localhost/talk/uploads',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer local-oidc-token-123456789' },
      body: JSON.stringify({
        entry: 'index.html',
        files: [
          {
            path: 'index.html',
            size: content.length,
            sha256: await sha256(content),
          },
        ],
        ...(publication === undefined ? {} : { publication }),
      }),
    },
    env,
  )
  return response
}

async function upload(content: string, publication?: unknown) {
  const response = await start(content, publication)
  expect(response.status).toBe(201)
  const { deploymentId, credential } = startSchema.parse(await response.json())
  const auth = { Authorization: `Bearer ${credential}` }
  expect(
    (
      await uploadsApi.request(
        `http://localhost/${deploymentId}/files/0`,
        { method: 'PUT', headers: auth, body: content },
        env,
      )
    ).status,
  ).toBe(200)
  const finalize = () =>
    uploadsApi.request(
      `http://localhost/${deploymentId}/finalize`,
      { method: 'POST', headers: auth },
      env,
    )
  return { deploymentId, finalize }
}

const finish = async (finalize: () => Response | Promise<Response>) => {
  const response = await finalize()
  expect(response.status).toBe(200)
  return finalizeSchema.parse(await response.json()).publication
}
const publication = async () =>
  (await readPublication(db, 'talk', OWNER_ID))?.publication

test('Given repository mode, When a run asks to publish, Then finalize makes it public', async () => {
  const { deploymentId, finalize } = await upload('a', { published: true })
  expect(await finish(finalize)).toEqual({ applied: true })
  expect(await publication()).toEqual({ kind: 'public', deploymentId })
})

test('Given a public deck, When a run says published: false, Then public delivery stops', async () => {
  const { finalize } = await upload('a', { published: true })
  await finish(finalize)
  run.id = '21'
  const off = await upload('b', { published: false })
  expect(await finish(off.finalize)).toEqual({ applied: true })
  expect(await publication()).toEqual({ kind: 'draft' })
  run.id = '20'
})

test('Given two runs, When the newer finishes first, Then the older stays a draft', async () => {
  run.id = '20'
  const older = await upload('a', { published: true })
  run.id = '21'
  const newer = await upload('b', { published: true })
  expect(await finish(newer.finalize)).toEqual({ applied: true })
  expect(await finish(older.finalize)).toEqual({
    applied: false,
    reason: 'older_run',
  })
  expect(await publication()).toEqual({
    kind: 'public',
    deploymentId: newer.deploymentId,
  })
  run.id = '20'
})

test('Given an applied run, When finalize is resent, Then publication is unchanged', async () => {
  const { finalize } = await upload('a', { published: true })
  await finish(finalize)
  const revision = (await readPublication(db, 'talk', OWNER_ID))?.revision
  expect(await finish(finalize)).toEqual({
    applied: false,
    reason: 'recorded_run',
  })
  expect((await readPublication(db, 'talk', OWNER_ID))?.revision).toBe(revision)
})

test('Given a pause after the upload started, When the run finishes, Then it stays a draft even after a resume', async () => {
  const { finalize } = await upload('a', { published: true })
  await db
    .prepare(
      'UPDATE decks SET paused_at = 1, revision = revision + 1, author_revision = revision + 1',
    )
    .run()
  expect(await finish(finalize)).toEqual({ applied: false, reason: 'paused' })
  await db
    .prepare(
      'UPDATE decks SET paused_at = NULL, revision = revision + 1, author_revision = revision + 1',
    )
    .run()
  expect(await finish(finalize)).toEqual({
    applied: false,
    reason: 'stale_revision',
  })
  expect(await publication()).toEqual({ kind: 'draft' })
})

test.each([
  ['manual mode', 'manual', { published: true }, 'manual_mode'],
  ['no publication section', 'repository', undefined, 'no_intent'],
])(
  'Given %s, When the run finishes, Then it stays a draft',
  async (_, mode, request, reason) => {
    await db.prepare('UPDATE decks SET publication_mode = ?').bind(mode).run()
    const { finalize } = await upload('a', request)
    expect(await finish(finalize)).toEqual({ applied: false, reason })
    expect(await publication()).toEqual({ kind: 'draft' })
  },
)

test('Given a started run, When it restarts asking for a different publication, Then the start conflicts', async () => {
  expect((await start('a', { published: true })).status).toBe(201)
  const replay = await start('a', { published: false })
  expect(replay.status).toBe(409)
  expect(await replay.json()).toMatchObject({ code: 'intent_conflict' })
})

test.each([
  ['a string flag', { published: 'true' }],
  ['an extra field', { published: true, at: 1 }],
  ['a non-object', true],
])(
  'Given %s, When an upload starts, Then it is rejected',
  async (_, request) => {
    expect((await start('a', request)).status).toBe(400)
  },
)
