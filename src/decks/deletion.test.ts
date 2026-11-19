import { and, eq, isNull } from 'drizzle-orm'
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
import {
  contentSessions,
  decks,
  deployments,
  previewLaunches,
  purgedPrefixes,
  uploadFiles,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { readAccessFacts } from '../preview/access-store'
import { issueLaunch } from '../preview/store'
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
import {
  markDeckDeleted,
  purgeDelaySeconds,
  purgeDeletedDecks,
} from './deletion-store'
import { resolveDeck } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const bucket = platform.env.UPLOADS
const env = testEnv(platform.env)
const GRACE = 3600
const deletedAt = 1000
const afterGrace = deletedAt + GRACE

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await orm.delete(purgedPrefixes)
  const listed = await bucket.list()
  if (listed.objects.length)
    await bucket.delete(listed.objects.map(({ key }) => key))
  await seedDeck(db, 'talk')
  await seedDeck(db, 'theirs', '1')
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

/** A ready, public deployment with an object, a session, and a launch. */
async function seedPublicDeck(deck = 'talk') {
  const id = await seedDeployment(db, deck)
  await bucket.put(`${id}/0/index.html`, 'a')
  await orm.batch([
    orm.insert(uploadFiles).values({
      deployment_id: id,
      id: '0',
      path: 'index.html',
      size: 1,
      sha256: 'c'.repeat(64),
      media_type: 'text/html',
      object_key: `${id}/0/index.html`,
    }),
    orm
      .update(decks)
      .set({ public_deployment_id: id })
      .where(eq(decks.id, deck)),
    orm.insert(contentSessions).values({
      token_hash: `session-${id}`,
      deployment_id: id,
      owner_user_id: OWNER_ID,
      created_at: 1,
      expires_at: 999999999999,
      hard_expires_at: 999999999999,
    }),
    orm.insert(previewLaunches).values({
      token_hash: `launch-${id}`,
      deployment_id: id,
      owner_user_id: OWNER_ID,
      created_at: 1,
      expires_at: 999999999999,
      consumed_at: null,
      session_hash: null,
    }),
  ])
  return id
}

const isPublic = async (deploymentId: string) =>
  (
    await readAccessFacts(db, {
      deploymentId,
      sessionToken: null,
      authors: new Set([OWNER_ID]),
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
  expect(await orm.$count(contentSessions)).toBe(0)
  expect(await orm.$count(previewLaunches)).toBe(0)
  expect(
    await orm.$count(
      deployments,
      and(eq(deployments.id, open), eq(deployments.state, 'expired')),
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
  expect(await resolveDeck(db, OWNER_ID, 'talk')).toMatchObject({
    deleted: true,
  })
  // Objects stay until the purge, so a late receive is removed with them.
  expect(await keys()).toEqual([`${shown}/0/index.html`])
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

test('given a start that passed its owner check before the deletion, when it inserts after, then no session holds the quota', async () => {
  await remove()
  const inserted = await insertSessionWithinQuota(
    drizzle(db),
    {
      id: 'late-start',
      key: 'late-start',
      digest: 'digest',
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      source: 'browser',
      inventory: parseInventoryStructure({
        entry: 'index.html',
        files: [{ path: 'index.html', size: 1, sha256: 'a'.repeat(64) }],
      }),
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
    await orm.$count(
      decks,
      and(
        eq(decks.id, 'theirs'),
        isNull(decks.deleted_at),
        eq(decks.public_deployment_id, shown),
      ),
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
    resweptPrefixes: 0,
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
    resweptPrefixes: 0,
    deletedObjects: 2,
    failed: 0,
  })
  expect(await keys()).toEqual([`${theirs}/0/index.html`])
  expect(await orm.$count(decks, eq(decks.id, 'talk'))).toBe(0)
  expect(
    await orm.$count(uploadFiles, eq(uploadFiles.deployment_id, mine)),
  ).toBe(0)
  // The deck name is free again.
  await seedDeck(db, 'talk')
  expect(await resolveDeck(db, OWNER_ID, 'talk')).toMatchObject({
    deleted: false,
  })
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
  expect(await orm.$count(decks, eq(decks.id, 'talk'))).toBe(1)
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

const deleteForm = (cookie: string, confirm: string, deck = 'talk') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/slides/${deck}/delete`, {
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
  expect(response.headers.get('location')).toBe('/slides')
  const page = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk`, { headers: { Cookie: cookie } }),
    env,
  )
  expect(page.status).toBe(404)
  expect((await deleteForm(cookie, 'theirs', 'theirs')).status).toBe(404)
})

test('given a request from another origin, when the deletion form is sent, then it is refused', async () => {
  const cookie = await signIn(env)
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk/delete`, {
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

test('given an object a receive writes after the purge, when later runs list the purged prefix, then it is removed and the record is forgotten after 30 days', async () => {
  const id = await seedPublicDeck()
  await remove()
  await purgeDeletedDecks(env, afterGrace, GRACE)
  // The receive passed its lease check before the deletion and lands now.
  await bucket.put(`${id}/0/late.css`, 'late')
  const week = 7 * 24 * 60 * 60
  expect(
    (await purgeDeletedDecks(env, afterGrace + week - 1, GRACE))
      .resweptPrefixes,
  ).toBe(0)
  expect(await purgeDeletedDecks(env, afterGrace + week, GRACE)).toMatchObject({
    resweptPrefixes: 1,
    deletedObjects: 1,
  })
  expect(await keys()).toEqual([])
  const remembered = () =>
    orm.$count(purgedPrefixes, eq(purgedPrefixes.deployment_id, id))
  expect(await remembered()).toBe(1)
  for (let at = afterGrace + 2 * week; at <= afterGrace + 5 * week; at += week)
    await purgeDeletedDecks(env, at, GRACE)
  expect(await remembered()).toBe(0)
})

test('given starts used in the last 24 hours, when the deck is deleted, then the purge waits until they no longer count', async () => {
  const delay = purgeDelaySeconds(DEFAULT_UPLOAD_LIMITS)
  expect(delay).toBe(24 * 60 * 60)
  // Fewer than one purge run's batch, so a single run removes them all.
  const used = 3
  for (let index = 0; index < used; index++) {
    const id = await seedDeployment(db, 'talk')
    await orm
      .update(deployments)
      .set({ created_at: deletedAt - 10 })
      .where(eq(deployments.id, id))
  }
  await remove()
  const starts = async (at: number) =>
    (await readQuotaUsage(drizzle(db), OWNER_ID, at)).startsInWindow
  const hourLater = deletedAt + DEFAULT_UPLOAD_LIMITS.orphanGraceSeconds
  expect((await purgeDeletedDecks(env, hourLater, delay)).deployments).toBe(0)
  expect(await starts(hourLater)).toBe(used)
  // Once purged, the starts are past the window anyway.
  expect(await starts(deletedAt + delay)).toBe(0)
  expect(
    (await purgeDeletedDecks(env, deletedAt + delay, delay)).deployments,
  ).toBe(used)
})
