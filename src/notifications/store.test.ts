import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { accounts, deployments, notifications, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { markAccountDeleted, markDeckDeleted } from '../decks/deletion-store'
import { mute, unmute } from '../mutes/store'
import { applyAuthorCommand } from '../publication/author'
import { readPublication } from '../publication/store'
import { applySuspensionCommand } from '../publication/suspension-store'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import type { AuthorCommand } from '../publication/transitions'
import { recordCitations } from '../reactions/citation-store'
import {
  countUnread,
  listNotifications,
  markAllRead,
  readOptOuts,
  setReceive,
} from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const env = testEnv(platform.env)
const db = drizzle(database)
const alice = '101'
const bob = '202'
const carol = '303'
const citingDeck = 'deck-b'
const targetDeck = 'deck-a'
const mutedPair = { muter: alice, muted: bob }

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await db.insert(accounts).values([
    { user_id: alice, handle: 'alice', created_at: 1 },
    { user_id: bob, handle: 'bob', created_at: 1 },
    { user_id: carol, handle: 'carol', created_at: 1 },
  ])
  await seedPublic(database, targetDeck, 5, 'Original', alice, 'original')
  await seedDeck(database, citingDeck, bob, 'response')
})
afterAll(() => platform.dispose())

async function prepareVersion(
  paths = ['/@alice/original'],
  title = 'Response',
) {
  const deploymentId = await seedDeployment(database, citingDeck)
  const key = `${deploymentId}/0/lease`
  const body = paths
    .map((path) => `<a href="${TEST_ORIGIN}${path}">source</a>`)
    .join('\n')
  await env.UPLOADS.put(key, body)
  await db.batch([
    db.insert(uploadFiles).values({
      deployment_id: deploymentId,
      id: '0',
      path: 'index.html',
      size: body.length,
      sha256: 'x',
      media_type: 'text/html',
      object_key: key,
    }),
    db
      .update(deployments)
      .set({ title })
      .where(eq(deployments.id, deploymentId)),
  ])
  await recordCitations(env, deploymentId)
  return deploymentId
}

async function changePublication(
  command: AuthorCommand,
  revision: number,
  now: number,
) {
  const result = await applyAuthorCommand(database, {
    ownerUserId: bob,
    deckId: citingDeck,
    expectedRevision: revision,
    command,
    now,
  })
  expect(result.kind).toBe('applied')
}

async function publishFirst() {
  const deploymentId = await prepareVersion()
  await changePublication({ kind: 'publish', deploymentId }, 0, 10)
  return deploymentId
}

const list = (userId = alice, limit = 10) =>
  listNotifications(database, userId, limit)

async function expectVisible(count: number, userId = alice) {
  expect(await list(userId)).toHaveLength(count)
  expect(await countUnread(database, userId)).toBe(count)
}

// A stored join notification exercises the read path without a GitHub lookup.
const joined = (id: string, recipient: string, actor: string, at: number) =>
  db.insert(notifications).values({
    id,
    kind: 'github_followee_joined',
    recipient_user_id: recipient,
    actor_user_id: actor,
    created_at: at,
  })

test('F20-AC3: Given an upload links to several pages of Alice’s deck and another deck of Bob’s, When Bob publishes, updates and republishes, Then Alice keeps one notification and Bob receives none', async () => {
  await seedDeck(database, 'other-bob-deck', bob, 'earlier')
  const paths = ['/@alice/original/2', '/@alice/original/9', '/@bob/earlier']
  const first = await prepareVersion(paths)
  await expectVisible(0)
  await changePublication({ kind: 'publish', deploymentId: first }, 0, 10)
  const original = await list()
  expect(original).toEqual([
    {
      id: expect.any(String),
      kind: 'cited',
      at: 10,
      unread: true,
      actor: { handle: 'bob' },
      deck: { handle: 'bob', slug: 'response', title: 'Response' },
      target: { slug: 'original', title: 'Original' },
    },
  ])
  const updated = await prepareVersion(paths, 'Revised response')
  await changePublication({ kind: 'publish', deploymentId: updated }, 1, 20)
  const revised = await list()
  expect(revised).toEqual([
    {
      ...original[0],
      deck: { handle: 'bob', slug: 'response', title: 'Revised response' },
    },
  ])
  await changePublication({ kind: 'pause' }, 2, 30)
  await expectVisible(0)
  await changePublication({ kind: 'publish', deploymentId: updated }, 3, 40)
  expect(await list()).toEqual(revised)
  await expectVisible(1)
  await expectVisible(0, bob)
  expect(await db.select().from(notifications)).toHaveLength(1)
})

test('F20-AC3: Given links to public, draft and deleted decks, When Bob publishes, Then each live target gets a distinct notification using its current public title', async () => {
  await seedDeck(database, 'draft', carol, 'original')
  await seedDeck(database, 'other', alice)
  await seedDeck(database, 'removed', alice)
  await markDeckDeleted(database, {
    deckId: 'removed',
    ownerUserId: alice,
    now: 5,
  })
  await seedDeck(database, 'only-in-draft', carol)
  await prepareVersion(['/@carol/only-in-draft'])
  const deploymentId = await prepareVersion([
    '/@alice/original',
    '/@alice/other',
    '/@carol/original',
    '/@alice/removed',
  ])
  await changePublication({ kind: 'publish', deploymentId }, 0, 10)
  const aliceItems = await list(alice)
  const carolItems = await list(carol)
  expect(aliceItems).toHaveLength(2)
  expect(aliceItems).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        target: { slug: 'original', title: 'Original' },
      }),
      expect.objectContaining({ target: { slug: 'other', title: null } }),
    ]),
  )
  expect(carolItems).toMatchObject([
    { target: { slug: 'original', title: null } },
  ])
  expect(new Set([...aliceItems, ...carolItems].map(({ id }) => id)).size).toBe(
    3,
  )
  expect(await db.select().from(notifications)).toHaveLength(3)
  await markDeckDeleted(database, {
    deckId: targetDeck,
    ownerUserId: alice,
    now: 20,
  })
  await expectVisible(1)
  await expectVisible(1, carol)
})

test('F20-AC7: Given default receipt, When Alice opts out before publication and opts back in twice, Then the skipped citation was never stored and the next publication delivers one', async () => {
  expect(await readOptOuts(database, alice)).toEqual([])
  await setReceive(database, alice, 'cited', false)
  await setReceive(database, alice, 'cited', false)
  expect(await readOptOuts(database, alice)).toEqual(['cited'])
  await publishFirst()
  await setReceive(database, alice, 'cited', true)
  await setReceive(database, alice, 'cited', true)
  expect(await readOptOuts(database, alice)).toEqual([])
  expect(await db.select().from(notifications)).toEqual([])
  const deploymentId = await prepareVersion()
  await changePublication({ kind: 'publish', deploymentId }, 1, 20)
  await expectVisible(1)
})

test('F20-AC8: Given Alice muted Bob, When he publishes and she later unmutes him, Then no citation was delivered', async () => {
  await mute(database, { ...mutedPair, now: 5 })
  await publishFirst()
  await unmute(database, mutedPair)
  expect(await db.select().from(notifications)).toEqual([])
  await expectVisible(0)
})

test('F20-AC8: Given Alice has a citation and a join notification from Bob, When she mutes and unmutes him, Then both disappear from and return to the list and count', async () => {
  await publishFirst()
  await joined('joined', alice, bob, 11)
  await expectVisible(2)
  await mute(database, { ...mutedPair, now: 20 })
  await expectVisible(0)
  await unmute(database, mutedPair)
  await expectVisible(2)
})

test('F20-AC10: Given a citation and join from Bob, When his deck is hidden or his account suspended, Then the affected items leave the list and unread count until release', async () => {
  await publishFirst()
  await joined('joined', alice, bob, 11)
  const before = await list()
  await applyOperatorCommand(database, {
    deckId: citingDeck,
    command: { kind: 'hide', reason: 'test reason', operator: 'op' },
    now: 20,
  })
  expect((await list()).map((row) => row.kind)).toEqual([
    'github_followee_joined',
  ])
  expect(await countUnread(database, alice)).toBe(1)
  await applyOperatorCommand(database, {
    deckId: citingDeck,
    command: { kind: 'release' },
    now: 30,
  })
  expect(await list()).toEqual(before)
  await expectVisible(2)
  await applySuspensionCommand(database, {
    userId: bob,
    command: { kind: 'suspend', reason: 'test reason', operator: 'op' },
    now: 40,
  })
  await expectVisible(0)
  await applySuspensionCommand(database, {
    userId: bob,
    command: { kind: 'release' },
    now: 50,
  })
  expect(await list()).toEqual(before)
  await expectVisible(2)
})

test('F20-AC10: Given Alice received a citation, When an operator hides her cited deck, Then the citation leaves the list and unread count until release', async () => {
  await publishFirst()
  const before = await list()
  const cited = await db
    .select({ id: notifications.target_deck_id })
    .from(notifications)
    .get()
  await applyOperatorCommand(database, {
    deckId: String(cited?.id),
    command: { kind: 'hide', reason: 'test reason', operator: 'op' },
    now: 20,
  })
  await expectVisible(0)
  await applyOperatorCommand(database, {
    deckId: String(cited?.id),
    command: { kind: 'release' },
    now: 30,
  })
  expect(await list()).toEqual(before)
})

test('Given Alice muted Bob while his notifications were unread, When she marks all read and unmutes him, Then his notifications return unread', async () => {
  await publishFirst()
  await joined('joined', alice, bob, 11)
  await mute(database, { muter: alice, muted: bob, now: 20 })
  await markAllRead(database, alice, 30)
  await unmute(database, { muter: alice, muted: bob })
  expect(await countUnread(database, alice)).toBe(2)
})

test('F20-AC10: Given a stored citation and join, When the actor no longer has an account row, Then neither is listed or counted', async () => {
  await publishFirst()
  await joined('joined', alice, bob, 11)
  await db.delete(accounts).where(eq(accounts.user_id, bob))
  await expectVisible(0)
})

test('Given unread notifications for Alice and Carol, When Alice lists the newest item and marks all hers read, Then her full list is read and Carol’s count stays one', async () => {
  await publishFirst()
  await joined('newest', alice, bob, 11)
  await joined('carol', carol, bob, 12)
  expect(await list(alice, 1)).toEqual([
    {
      id: 'newest',
      kind: 'github_followee_joined',
      at: 11,
      unread: true,
      actor: { handle: 'bob' },
    },
  ])
  expect(await countUnread(database, alice)).toBe(2)
  await markAllRead(database, alice, 20)
  await markAllRead(database, alice, 30)
  expect((await list()).map(({ at, unread }) => ({ at, unread }))).toEqual([
    { at: 11, unread: false },
    { at: 10, unread: false },
  ])
  expect(await countUnread(database, alice)).toBe(0)
  await expectVisible(1, carol)
})

test.each([
  { role: 'recipient', user: alice },
  { role: 'actor', user: bob },
])(
  'F20-AC11: Given a stored citation, When its $role deletes their account, Then that citation and their opt-outs are deleted while unrelated rows survive',
  async ({ user }) => {
    await publishFirst()
    const other = user === alice ? bob : alice
    await joined('unrelated', carol, other, 12)
    await setReceive(database, user, 'cited', false)
    await setReceive(database, other, 'github_followee_joined', false)
    await markAccountDeleted(database, { ownerUserId: user, now: 20 })
    expect(
      await db.select({ id: notifications.id }).from(notifications),
    ).toEqual([{ id: 'unrelated' }])
    expect(await readOptOuts(database, user)).toEqual([])
    expect(await readOptOuts(database, other)).toEqual([
      'github_followee_joined',
    ])
  },
)

test('F20-AC3: Given D1 refuses a notification insert, When Bob publishes a citing deck, Then publication succeeds and the failure is logged', async () => {
  await db.run(sql`CREATE TRIGGER refuse_notification BEFORE INSERT ON notifications
    BEGIN SELECT RAISE(ABORT, 'test refusal'); END`)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const deploymentId = await publishFirst()
    expect(
      (await readPublication(database, citingDeck, bob))?.publication,
    ).toEqual({
      kind: 'public',
      deploymentId,
    })
    expect(await db.select().from(notifications)).toEqual([])
    expect(
      log.mock.calls.map(([message]) => JSON.parse(message)),
    ).toContainEqual({
      event: 'notifications_unrecorded',
      deckId: citingDeck,
      name: expect.any(String),
    })
  } finally {
    log.mockRestore()
    await db.run(sql`DROP TRIGGER refuse_notification`)
  }
})
