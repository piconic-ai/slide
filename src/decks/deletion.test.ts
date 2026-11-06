import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { decks, deploymentRowSchema, deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { readAccessFacts } from '../preview/access-store'
import { issueLaunch } from '../preview/store'
import { applyCiPublication } from '../publication/ci'
import { readPublication, saveTransition } from '../publication/store'
import { decideAuthor } from '../publication/transitions'
import { DEFAULT_UPLOAD_LIMITS } from '../uploads/limits'
import {
  insertSessionWithinQuota,
  readQuotaUsage,
} from '../uploads/start-store'
import { parseInventoryStructure } from '../uploads/inventory'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { bindingRequestSchema } from './binding'
import { markDeckDeleted, purgeDeletedDecks } from './deletion'
import { saveBinding } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const bucket = platform.env.UPLOADS
const env = testEnv(platform.env)
const GRACE = 3600
const deletedAt = 1000
const afterGrace = deletedAt + GRACE

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  const listed = await bucket.list()
  if (listed.objects.length)
    await bucket.delete(listed.objects.map(({ key }) => key))
  await seedDeck(db, 'talk')
  await seedDeck(db, 'theirs', '1')
  await bind('talk')
  await bind('theirs', '1')
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

function bind(deck: string, owner = OWNER_ID, deckLimit = 20) {
  return saveBinding(db, {
    ownerUserId: owner,
    request: bindingRequestSchema.parse({
      deck,
      repository: 'piconic-ai/slide',
      branches: ['main'],
    }),
    repository: {
      repositoryId: '1',
      repositoryOwnerId: '2',
      fullName: 'piconic-ai/slide',
    },
    deckLimit,
    now: 1,
  })
}

/** A ready, public deployment with an object, a session, and a launch. */
async function seedPublicDeck(deck = 'talk') {
  const id = await seedDeployment(db, deck)
  await bucket.put(`${id}/0/index.html`, 'a')
  await db.batch([
    db
      .prepare(
        `INSERT INTO upload_files VALUES (?, '0', 'index.html', 1, ?, 'text/html', ?)`,
      )
      .bind(id, 'c'.repeat(64), `${id}/0/index.html`),
    db
      .prepare('UPDATE decks SET public_deployment_id = ? WHERE id = ?')
      .bind(id, deck),
    db
      .prepare(
        'INSERT INTO content_sessions VALUES (?, ?, ?, 1, 999999999999, 999999999999)',
      )
      .bind(`session-${id}`, id, OWNER_ID),
    db
      .prepare(
        'INSERT INTO preview_launches VALUES (?, ?, ?, 1, 999999999999, NULL, NULL)',
      )
      .bind(`launch-${id}`, id, OWNER_ID),
  ])
  return id
}

const count = async (sql: string, ...values: unknown[]) =>
  (
    await db
      .prepare(sql)
      .bind(...values)
      .first<{ count: number }>()
  )?.count
const isPublic = async (deploymentId: string) =>
  (
    await readAccessFacts(db, {
      deploymentId,
      sessionToken: null,
      allowedOwnerId: OWNER_ID,
      now: deletedAt,
    })
  ).isPublic
const keys = async () => (await bucket.list()).objects.map(({ key }) => key)
const remove = (deckId = 'talk', ownerUserId = OWNER_ID) =>
  markDeckDeleted(db, { deckId, ownerUserId, now: deletedAt })

test('given a public deck with viewers and an open upload, when its owner deletes it, then nothing of it can be read, uploaded, or published', async () => {
  const shown = await seedPublicDeck()
  const open = await seedDeployment(db, 'talk', 'uploading')
  expect(await isPublic(shown)).toBe(true)

  expect(await remove()).toBe('deleted')

  expect(await isPublic(shown)).toBe(false)
  expect(await readPublication(db, 'talk', OWNER_ID)).toBeNull()
  expect(
    await count(
      "SELECT COUNT(*) AS count FROM repository_bindings WHERE deck_id = 'talk'",
    ),
  ).toBe(0)
  expect(await count('SELECT COUNT(*) AS count FROM content_sessions')).toBe(0)
  expect(await count('SELECT COUNT(*) AS count FROM preview_launches')).toBe(0)
  expect(
    await count(
      "SELECT COUNT(*) AS count FROM deployments WHERE id = ? AND state = 'expired'",
      open,
    ),
  ).toBe(1)
  expect(
    await issueLaunch(db, {
      deckId: 'talk',
      deploymentId: shown,
      ownerUserId: OWNER_ID,
      now: deletedAt,
    }),
  ).toBeNull()
  expect(await bind('talk')).toBe('deleting')
  // Objects stay until the purge, so a late receive is removed with them.
  expect(await keys()).toEqual([`${shown}/0/index.html`])
})

test('given a deck deleted while its upload finished, when the workflow asked to publish, then nothing is published', async () => {
  const ready = await seedDeployment(db, 'talk')
  await db.batch([
    db.prepare(
      "UPDATE decks SET publication_mode = 'repository' WHERE id = 'talk'",
    ),
    db
      .prepare(
        "UPDATE deployments SET publish_intent = 'published' WHERE id = ?",
      )
      .bind(ready),
  ])
  await remove()
  const row = deploymentRowSchema.parse(
    await drizzle(db)
      .select()
      .from(deployments)
      .where(eq(deployments.id, ready))
      .get(),
  )
  expect(await applyCiPublication(db, row, deletedAt)).toEqual({
    kind: 'skipped',
    reason: 'deck_deleted',
  })
  expect(
    await count(
      "SELECT COUNT(*) AS count FROM decks WHERE id = 'talk' AND public_deployment_id IS NOT NULL",
    ),
  ).toBe(0)
})

test('given a publication decided before the deletion, when it is saved after, then it does not land', async () => {
  const ready = await seedDeployment(db, 'talk')
  const before = await readPublication(db, 'talk', OWNER_ID)
  if (!before) throw new Error('missing deck')
  const decision = decideAuthor(
    before,
    { kind: 'publish', deploymentId: ready },
    before.revision,
  )
  if (decision.kind !== 'apply') throw new Error('expected a change')
  await remove()
  expect(
    await saveTransition(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      from: before,
      transition: decision.transition,
      now: deletedAt,
    }),
  ).toBe(false)
  // Even a transition read from the deleted state is refused.
  const after = await drizzle(db)
    .select({ revision: decks.revision })
    .from(decks)
    .where(eq(decks.id, 'talk'))
    .get()
  expect(
    await saveTransition(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      from: { ...before, revision: after?.revision ?? 0 },
      transition: decision.transition,
      now: deletedAt,
    }),
  ).toBe(false)
  expect(await isPublic(ready)).toBe(false)
})

test('given a start that passed its binding check before the deletion, when it inserts after, then no session holds the quota', async () => {
  await remove()
  const inserted = await insertSessionWithinQuota(
    drizzle(db),
    {
      id: 'late-start',
      key: 'late-start',
      digest: 'digest',
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      claims: {
        repository_id: '1',
        repository_owner_id: '2',
        actor_id: OWNER_ID,
        ref: 'refs/heads/main',
        sha: 'a'.repeat(40),
        run_id: '1',
        run_attempt: '1',
        event_name: 'push',
      },
      inventory: parseInventoryStructure({
        entry: 'index.html',
        files: [{ path: 'index.html', size: 1, sha256: 'a'.repeat(64) }],
      }),
      intent: null,
      tokenHash: 'hash',
      created: deletedAt,
    },
    DEFAULT_UPLOAD_LIMITS,
  )
  expect(inserted).toBe(false)
  expect(
    (await readQuotaUsage(drizzle(db), OWNER_ID, deletedAt)).activeSessions,
  ).toBe(0)
})

test("given another owner's deck, when someone deletes it, then it is reported missing and left as it was", async () => {
  const shown = await seedPublicDeck('theirs')
  expect(await remove('theirs')).toBe('not_found')
  expect(await remove('missing')).toBe('not_found')
  expect(await isPublic(shown)).toBe(true)
  expect(
    await count(
      "SELECT COUNT(*) AS count FROM decks WHERE id = 'theirs' AND deleted_at IS NULL AND public_deployment_id = ?",
      shown,
    ),
  ).toBe(1)
  expect(
    await count(
      "SELECT COUNT(*) AS count FROM repository_bindings WHERE deck_id = 'theirs'",
    ),
  ).toBe(1)
})

test('given a deleted deck, when it is deleted again, then the result is the same', async () => {
  expect(await remove()).toBe('deleted')
  expect(await remove()).toBe('deleted')
})

test('given a deleted deck within the grace period, when the purge runs, then nothing is removed yet', async () => {
  await seedPublicDeck()
  await remove()
  expect(await purgeDeletedDecks(env, afterGrace - 1, GRACE)).toEqual({
    deployments: 0,
    decks: 0,
    deletedObjects: 0,
    failed: 0,
  })
  expect(await keys()).toHaveLength(1)
})

test('given a deleted deck past the grace period, when the purge runs, then its objects and rows are gone and other decks are untouched', async () => {
  const mine = await seedPublicDeck()
  await bucket.put(`${mine}/1/late.css`, 'late')
  const theirs = await seedPublicDeck('theirs')
  await remove()

  expect(await purgeDeletedDecks(env, afterGrace, GRACE)).toEqual({
    deployments: 1,
    decks: 1,
    deletedObjects: 2,
    failed: 0,
  })
  expect(await keys()).toEqual([`${theirs}/0/index.html`])
  expect(
    await count("SELECT COUNT(*) AS count FROM decks WHERE id = 'talk'"),
  ).toBe(0)
  expect(
    await count(
      'SELECT COUNT(*) AS count FROM upload_files WHERE deployment_id = ?',
      mine,
    ),
  ).toBe(0)
  // The deck name is free again.
  expect(await bind('talk')).toBe('saved')
})

test('given an R2 failure during the purge, when the next run succeeds, then the deck is removed then', async () => {
  await seedPublicDeck()
  await remove()
  const failing = {
    list: bucket.list.bind(bucket),
    delete: () => Promise.reject(new Error('R2 unavailable')),
  } as unknown as R2Bucket
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(
    await purgeDeletedDecks({ ...env, UPLOADS: failing }, afterGrace, GRACE),
  ).toMatchObject({ deployments: 0, decks: 0, failed: 1 })
  expect(
    await count("SELECT COUNT(*) AS count FROM decks WHERE id = 'talk'"),
  ).toBe(1)
  expect(await purgeDeletedDecks(env, afterGrace, GRACE)).toMatchObject({
    deployments: 1,
    decks: 1,
    failed: 0,
  })
  expect(await keys()).toEqual([])
})

test('given a deleted deck with more deployments than one run handles, when the purge runs twice, then the deck goes in the second run', async () => {
  for (let index = 0; index < 12; index++) await seedDeployment(db, 'talk')
  await remove()
  expect(await purgeDeletedDecks(env, afterGrace, GRACE)).toMatchObject({
    deployments: 10,
    decks: 0,
  })
  expect(await purgeDeletedDecks(env, afterGrace, GRACE)).toMatchObject({
    deployments: 2,
    decks: 1,
  })
})

test('given a deck at the deck limit, when one is deleted, then a new deck can be connected', async () => {
  expect(await bind('other', OWNER_ID, 1)).toBe('deck_limit')
  await remove()
  expect(await bind('other', OWNER_ID, 1)).toBe('saved')
})

const deleteForm = (cookie: string, confirm: string, deck = 'talk') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/decks/${deck}/delete`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ confirm }),
    }),
    env,
  )

test('given the owner types another name, when the deletion form is sent, then nothing is deleted', async () => {
  const cookie = await signIn(env)
  const response = await deleteForm(cookie, 'tlak')
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('一致しません')
  expect(await readPublication(db, 'talk', OWNER_ID)).not.toBeNull()
})

test('given the owner types the deck name, when the deletion form is sent, then the deck page is gone', async () => {
  const cookie = await signIn(env)
  const response = await deleteForm(cookie, 'talk')
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('/decks')
  const page = await server.fetch(
    new Request(`${TEST_ORIGIN}/decks/talk`, { headers: { Cookie: cookie } }),
    env,
  )
  expect(page.status).toBe(404)
  expect((await deleteForm(cookie, 'theirs', 'theirs')).status).toBe(404)
})

test('given a request from another origin, when the deletion form is sent, then it is refused', async () => {
  const cookie = await signIn(env)
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/decks/talk/delete`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://evil.example',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ confirm: 'talk' }),
    }),
    env,
  )
  expect(response.status).toBe(403)
  expect(await readPublication(db, 'talk', OWNER_ID)).not.toBeNull()
})
