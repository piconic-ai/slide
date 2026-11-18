import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { accounts, follows, notifications } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { markAccountDeleted } from '../decks/deletion-store'
import { hasMuted, mute, unmute } from '../mutes/store'
import {
  countUnread,
  listNotifications,
  setReceive,
} from '../notifications/store'
import { applySuspensionCommand } from '../publication/suspension-store'
import { resetTables } from '../publication/test-support'
import { follow, isFollowing, listFollowing, unfollow } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const alice = '1'
const bob = '2'
const carol = '3'
const pair = { follower: alice, followee: bob }
const reverse = { follower: bob, followee: alice }

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await db.insert(accounts).values([
    { user_id: alice, handle: 'alice', created_at: 1 },
    { user_id: bob, handle: 'bob', created_at: 1 },
    { user_id: carol, handle: 'carol', created_at: 1 },
  ])
})
afterAll(() => platform.dispose())

test('F20-AC6: Given Alice follows Bob, When she repeats the follow, unfollows and follows again, Then Bob keeps the first notification', async () => {
  expect(await follow(database, { ...pair, now: 10 })).toBe(true)
  const first = await listNotifications(database, bob, 10)
  expect(first).toEqual([
    {
      id: expect.any(String),
      at: 10,
      kind: 'followed',
      unread: true,
      actor: { handle: 'alice' },
    },
  ])
  expect(await follow(database, { ...pair, now: 20 })).toBe(false)
  await unfollow(database, pair)
  expect(await isFollowing(database, pair)).toBe(false)
  expect(await follow(database, { ...pair, now: 30 })).toBe(true)
  expect(await listNotifications(database, bob, 10)).toEqual(first)
  expect(await countUnread(database, bob)).toBe(1)
  expect(await countUnread(database, alice)).toBe(0)
})

test.each(['mute', 'opt-out'])(
  'F20-AC7 / F20-AC8: Given Bob has a $0, When Alice follows him, Then the follow is stored without a notification',
  async (setting) => {
    if (setting === 'mute')
      await mute(database, { muter: bob, muted: alice, now: 5 })
    else await setReceive(database, bob, 'followed', false)
    expect(await follow(database, { ...pair, now: 10 })).toBe(true)
    expect(await isFollowing(database, pair)).toBe(true)
    expect(await db.select().from(notifications)).toEqual([])
  },
)

test.each([
  { follower: alice, followee: alice },
  { follower: 'gone', followee: bob },
  { follower: alice, followee: 'gone' },
])(
  'Given the pair $follower → $followee lacks two distinct accounts, When it is followed, Then no follow or notification is stored',
  async (input) => {
    expect(await follow(database, { ...input, now: 10 })).toBe(false)
    expect(await isFollowing(database, input)).toBe(false)
    expect(await db.select().from(notifications)).toEqual([])
  },
)

test('F21-AC5: Given reciprocal follows, When Alice mutes Bob and tries to follow again, Then only her follow is removed and unmuting does not restore it', async () => {
  await follow(database, { ...pair, now: 10 })
  await follow(database, { ...reverse, now: 10 })
  const muted = { muter: alice, muted: bob }
  expect(await mute(database, { ...muted, now: 20 })).toBe(true)
  expect(await isFollowing(database, pair)).toBe(false)
  expect(await isFollowing(database, reverse)).toBe(true)
  expect(await follow(database, { ...pair, now: 21 })).toBe(false)
  expect(await mute(database, { ...muted, now: 22 })).toBe(false)
  await unmute(database, muted)
  expect(await isFollowing(database, pair)).toBe(false)
})

test('Given D1 refuses to remove a follow, When its follower mutes the followee, Then the mute rolls back and the follow survives', async () => {
  await follow(database, { ...pair, now: 10 })
  await db.run(sql`CREATE TRIGGER refuse_unfollow BEFORE DELETE ON follows
    BEGIN SELECT RAISE(ABORT, 'test refusal'); END`)
  const muted = { muter: alice, muted: bob }
  try {
    await expect(mute(database, { ...muted, now: 20 })).rejects.toThrow()
    expect(await hasMuted(database, muted)).toBe(false)
    expect(await isFollowing(database, pair)).toBe(true)
  } finally {
    await db.run(sql`DROP TRIGGER refuse_unfollow`)
  }
})

test('Given an existing follow whose followee has no account row, When the follower attempts to mute that ID, Then the mute is refused and the follow survives', async () => {
  await follow(database, { ...pair, now: 10 })
  await db.delete(accounts).where(eq(accounts.user_id, bob))
  expect(await mute(database, { muter: alice, muted: bob, now: 20 })).toBe(
    false,
  )
  expect(await isFollowing(database, pair)).toBe(true)
})

test('Given Alice follows two people and someone follows her, When she lists her follows, Then she sees only her own followees newest first and missing or suspended accounts are omitted', async () => {
  await follow(database, { ...pair, now: 10 })
  await follow(database, { follower: alice, followee: carol, now: 20 })
  await follow(database, { ...reverse, now: 30 })
  expect(await listFollowing(database, alice)).toEqual(['carol', 'bob'])

  await applySuspensionCommand(database, {
    userId: bob,
    command: { kind: 'suspend', reason: 'test reason', operator: 'op' },
    now: 40,
  })
  expect(await listFollowing(database, alice)).toEqual(['carol'])
  await db.delete(accounts).where(eq(accounts.user_id, carol))
  expect(await listFollowing(database, alice)).toEqual([])
})

test('F21-AC6: Given Alice follows Bob and Bob follows Alice and Carol, When Alice deletes her account, Then the follow and notification between Bob and Carol survive', async () => {
  await follow(database, { ...pair, now: 10 })
  await follow(database, { ...reverse, now: 20 })
  await follow(database, { follower: bob, followee: carol, now: 30 })
  await markAccountDeleted(database, { ownerUserId: alice, now: 40 })
  expect(await db.select().from(follows)).toEqual([
    {
      follower_user_id: bob,
      followee_user_id: carol,
      created_at: 30,
    },
  ])
  expect(await db.select().from(notifications)).toEqual([
    expect.objectContaining({
      kind: 'followed',
      actor_user_id: bob,
      recipient_user_id: carol,
    }),
  ])
})

test('Given D1 refuses a followed notification, When Alice follows Bob, Then the follow remains stored and the delivery failure is logged', async () => {
  await db.run(sql`CREATE TRIGGER refuse_followed BEFORE INSERT ON notifications
    WHEN NEW.kind = 'followed' BEGIN SELECT RAISE(ABORT, 'test refusal'); END`)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect(await follow(database, { ...pair, now: 10 })).toBe(true)
    expect(await isFollowing(database, pair)).toBe(true)
    expect(await db.select().from(notifications)).toEqual([])
    expect(
      log.mock.calls.map(([message]) => JSON.parse(message)),
    ).toContainEqual(
      expect.objectContaining({
        event: 'notifications_unrecorded',
        kind: 'followed',
      }),
    )
  } finally {
    log.mockRestore()
    await db.run(sql`DROP TRIGGER refuse_followed`)
  }
})

test('F20-AC8 / F20-AC10: Given Bob was told that Alice follows him, When he mutes her or she is suspended, Then the notice leaves his list and count until it is undone', async () => {
  await follow(database, { ...pair, now: 10 })
  const visible = async () => [
    (await listNotifications(database, bob, 10)).length,
    await countUnread(database, bob),
  ]
  expect(await visible()).toEqual([1, 1])
  await mute(database, { muter: bob, muted: alice, now: 20 })
  expect(await visible()).toEqual([0, 0])
  await unmute(database, { muter: bob, muted: alice })
  expect(await visible()).toEqual([1, 1])
  await applySuspensionCommand(database, {
    userId: alice,
    command: { kind: 'suspend', reason: 'test reason', operator: 'op' },
    now: 30,
  })
  expect(await visible()).toEqual([0, 0])
})
