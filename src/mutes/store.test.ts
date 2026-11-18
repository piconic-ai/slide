import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { accounts, mutes } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { markAccountDeleted } from '../decks/deletion'
import { resetTables } from '../publication/test-support'
import { listMuted, mute, unmute } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const alice = '1'
const bob = '2'
const carol = '3'

const row = (muter: string, muted: string, now: number) => ({
  muter_user_id: muter,
  muted_user_id: muted,
  created_at: now,
})

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

test('F19-AC1: Given Alice mutes Bob, When she mutes him again, Then only the original mute is stored', async () => {
  const pair = { muter: alice, muted: bob }
  expect(await mute(database, { ...pair, now: 10 })).toBe(true)
  expect(await mute(database, { ...pair, now: 20 })).toBe(false)

  expect(await db.select().from(mutes)).toEqual([row(alice, bob, 10)])
})

test('F19-AC7: Given Alice, When she tries to mute herself, Then the operation returns false and stores nothing', async () => {
  const saved = await mute(database, { muter: alice, muted: alice, now: 10 })
  expect(saved).toBe(false)
  expect(await db.select().from(mutes)).toEqual([])
})

test('F19-AC5: Given several viewers have mutes, When Alice lists hers, Then she sees only the authors she muted with their handles, newest first', async () => {
  await db
    .insert(mutes)
    .values([row(alice, bob, 10), row(alice, carol, 20), row(carol, alice, 30)])

  expect(await listMuted(database, alice)).toEqual([
    { userId: carol, handle: 'carol' },
    { userId: bob, handle: 'bob' },
  ])
})

test('F19-AC5: Given reciprocal mutes and other muted authors, When Alice unmutes Bob, Then only her mute of Bob is removed', async () => {
  const others = [
    row(alice, carol, 20),
    row(bob, alice, 30),
    row(carol, bob, 40),
  ]
  await db.insert(mutes).values([row(alice, bob, 10), ...others])

  await unmute(database, { muter: alice, muted: bob })

  const remaining = await db.select().from(mutes).orderBy(mutes.created_at)
  expect(remaining).toEqual(others)
})

test.each([
  { who: 'Alice', id: alice, remaining: row(bob, carol, 20) },
  { who: 'Bob', id: bob, remaining: row(carol, alice, 30) },
])(
  'F19-AC8: Given Alice muted Bob, Bob muted Carol and Carol muted Alice, When $who deletes their account, Then only the mute between the other two remains',
  async ({ id, remaining }) => {
    await db
      .insert(mutes)
      .values([row(alice, bob, 10), row(bob, carol, 20), row(carol, alice, 30)])

    await markAccountDeleted(database, { ownerUserId: id, now: 40 })

    expect(await db.select().from(mutes)).toEqual([remaining])
  },
)

test('F19-AC8: Given a person who holds no account, When Alice mutes their user ID, Then nothing is stored', async () => {
  expect(await mute(database, { muter: alice, muted: 'gone', now: 10 })).toBe(
    false,
  )
  expect(await db.select().from(mutes)).toEqual([])
})
