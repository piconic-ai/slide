import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { accounts, blocks, follows, mutes, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { markAccountDeleted } from '../decks/deletion-store'
import { follow } from '../follows/store'
import { listMuted } from '../mutes/store'
import { resetTables } from '../publication/test-support'
import {
  block,
  blockedBetween,
  hasBlocked,
  listBlocked,
  unblock,
} from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const alice = '1'
const bob = '2'
const carol = '3'

const followRow = (follower: string, followee: string) => ({
  follower_user_id: follower,
  followee_user_id: followee,
  created_at: 1,
})
const blockRow = (blocker: string, blocked: string, now: number) => ({
  blocker_user_id: blocker,
  blocked_user_id: blocked,
  created_at: now,
})
const pairs = () =>
  db
    .select({
      follower: follows.follower_user_id,
      followee: follows.followee_user_id,
    })
    .from(follows)
    .orderBy(follows.follower_user_id, follows.followee_user_id)

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

test('F32-AC1: Given Alice and Bob follow each other and Carol, When Alice blocks Bob, Then both follows between them go and the others stay', async () => {
  await db
    .insert(follows)
    .values([
      followRow(alice, bob),
      followRow(bob, alice),
      followRow(alice, carol),
      followRow(bob, carol),
    ])

  expect(await block(database, { blocker: alice, blocked: bob, now: 10 })).toBe(
    true,
  )

  expect(await db.select().from(blocks)).toEqual([blockRow(alice, bob, 10)])
  expect(await pairs()).toEqual([
    { follower: alice, followee: carol },
    { follower: bob, followee: carol },
  ])
})

test('F32-AC1: Given Alice blocked Bob, When she blocks him again after a follow slipped in, Then the first block stays and the follow goes again', async () => {
  await block(database, { blocker: alice, blocked: bob, now: 10 })
  await db.insert(follows).values(followRow(alice, bob))

  expect(await block(database, { blocker: alice, blocked: bob, now: 20 })).toBe(
    false,
  )

  expect(await db.select().from(blocks)).toEqual([blockRow(alice, bob, 10)])
  expect(await pairs()).toEqual([])
})

test('F32-AC2, F21-AC64: Given Alice blocked Bob, When Bob follows Alice, Then nothing is stored, while Carol may still follow her', async () => {
  await block(database, { blocker: alice, blocked: bob, now: 10 })

  expect(
    await follow(database, { follower: bob, followee: alice, now: 20 }),
  ).toBe(false)
  expect(
    await follow(database, { follower: carol, followee: alice, now: 20 }),
  ).toBe(true)

  expect(await pairs()).toEqual([{ follower: carol, followee: alice }])
})

test('F32-AC2: Given Alice blocked Bob, When Alice follows Bob, Then nothing is stored, while she may still follow Carol', async () => {
  await block(database, { blocker: alice, blocked: bob, now: 10 })

  expect(
    await follow(database, { follower: alice, followee: bob, now: 20 }),
  ).toBe(false)
  expect(
    await follow(database, { follower: alice, followee: carol, now: 20 }),
  ).toBe(true)

  expect(await pairs()).toEqual([{ follower: alice, followee: carol }])
})

test('F32-AC2: Given Alice blocked Bob, When either of them or Carol asks whether a block stands between two people, Then only the pair of Alice and Bob has one, both ways', async () => {
  await block(database, { blocker: alice, blocked: bob, now: 10 })

  expect(await blockedBetween(database, alice, bob)).toBe(true)
  expect(await blockedBetween(database, bob, alice)).toBe(true)
  expect(await blockedBetween(database, alice, carol)).toBe(false)
  expect(await blockedBetween(database, carol, bob)).toBe(false)
})

test('F32-AC10: Given Alice blocked Bob and their follows went, When she unblocks him, Then the block goes, the follows stay gone, and each may follow the other again', async () => {
  await db
    .insert(follows)
    .values([followRow(alice, bob), followRow(bob, alice)])
  await block(database, { blocker: alice, blocked: bob, now: 10 })

  await unblock(database, { blocker: alice, blocked: bob })

  expect(await hasBlocked(database, { blocker: alice, blocked: bob })).toBe(
    false,
  )
  expect(await pairs()).toEqual([])
  expect(
    await follow(database, { follower: bob, followee: alice, now: 20 }),
  ).toBe(true)
  expect(
    await follow(database, { follower: alice, followee: bob, now: 20 }),
  ).toBe(true)
})

test('F32-AC10: Given blocks both ways and of others, When Alice unblocks Bob, Then only her block of Bob goes', async () => {
  await db
    .insert(blocks)
    .values([
      blockRow(alice, bob, 1),
      blockRow(bob, alice, 1),
      blockRow(alice, carol, 1),
    ])

  await unblock(database, { blocker: alice, blocked: bob })

  expect(
    await db
      .select()
      .from(blocks)
      .orderBy(blocks.blocker_user_id, blocks.blocked_user_id),
  ).toEqual([blockRow(alice, carol, 1), blockRow(bob, alice, 1)])
})

test('F32-AC11: Given Alice, When she blocks herself, Then nothing is stored and her follows stay', async () => {
  await db.insert(follows).values(followRow(alice, bob))

  expect(
    await block(database, { blocker: alice, blocked: alice, now: 10 }),
  ).toBe(false)

  expect(await db.select().from(blocks)).toEqual([])
  expect(await pairs()).toEqual([{ follower: alice, followee: bob }])
})

test('F32-AC11: Given the table, When a row blocking oneself is written directly, Then the database refuses it', async () => {
  await expect(
    db.insert(blocks).values(blockRow(alice, alice, 1)),
  ).rejects.toThrow()
})

test.each([
  ['an unknown person', alice, '404'],
  ['a blocker with no account', '404', bob],
])(
  'Given %s, When a block is asked, Then nothing is stored and no follow goes',
  async (_, blocker, blocked) => {
    await db.insert(follows).values(followRow(alice, bob))

    expect(await block(database, { blocker, blocked, now: 10 })).toBe(false)

    expect(await db.select().from(blocks)).toEqual([])
    expect(await pairs()).toEqual([{ follower: alice, followee: bob }])
  },
)

test('Given Bob is suspended, When Alice blocks him, Then nothing is stored', async () => {
  await db.insert(suspensions).values({
    user_id: bob,
    reason: 'spam',
    suspended_at: 1,
    suspended_by: 'operator',
  })

  expect(await block(database, { blocker: alice, blocked: bob, now: 10 })).toBe(
    false,
  )
  expect(await db.select().from(blocks)).toEqual([])
})

test('F32-AC13: Given Alice muted Carol and blocked Bob and Carol, When her lists are read, Then the block list holds her blocks, latest first, and the mute list only her mute', async () => {
  await db.insert(mutes).values({
    muter_user_id: alice,
    muted_user_id: carol,
    created_at: 1,
  })
  await db
    .insert(blocks)
    .values([
      blockRow(alice, bob, 10),
      blockRow(alice, carol, 20),
      blockRow(bob, alice, 30),
    ])
  await db.insert(mutes).values({
    muter_user_id: bob,
    muted_user_id: carol,
    created_at: 2,
  })

  expect(await listBlocked(database, alice)).toEqual([
    { userId: carol, handle: 'carol' },
    { userId: bob, handle: 'bob' },
  ])
  expect(await listMuted(database, alice)).toEqual([
    { userId: carol, handle: 'carol' },
  ])
})

test('F32-AC18: Given Alice blocked Bob and Carol blocked Alice, When Alice leaves, Then both blocks go and Bob’s block of Carol stays', async () => {
  await db
    .insert(blocks)
    .values([
      blockRow(alice, bob, 1),
      blockRow(carol, alice, 1),
      blockRow(bob, carol, 1),
    ])

  await markAccountDeleted(database, { ownerUserId: alice, now: 10 })

  expect(await db.select().from(blocks)).toEqual([blockRow(bob, carol, 1)])
})
