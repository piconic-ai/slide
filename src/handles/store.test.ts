import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { createAccount } from '../auth/accounts-store'
import { accounts, handles, profiles, releasedHandles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { markAccountDeleted } from '../decks/deletion-store'
import { resetTables, seedPerson } from '../publication/test-support'
import type { Handle } from '../share/handle'
import { HANDLE_HOLD_SECONDS } from './hold'
import { handleRefusalText } from './refusals'
import {
  handleAvailability,
  ownsHandle,
  readOwnerHandle,
  releaseHandleSteps,
  takeHandle,
  type HandleOwner,
} from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

beforeAll(() => applyMigrations(database))
beforeEach(() => resetTables(database))
afterAll(() => platform.dispose())

const h = (text: string) => text as Handle
const NOW = 1_000_000_000

const community = (id: string): HandleOwner => ({ kind: 'community', id })

/** A community's handle, taken the way the community form takes it. */
const takeForCommunity = (handle: string, id: string, now = NOW) =>
  takeHandle(database, {
    handle: h(handle),
    owner: community(id),
    now,
    rest: [],
  })

async function signUp(userId: string, handle: string, now = NOW) {
  await seedPerson(database, userId)
  return createAccount(database, {
    userId,
    handle: h(handle),
    displayName: userId,
    now,
  })
}

test('F30-AC1: Given a person uses a handle, When a community takes it, Then it is refused as taken and the person keeps it', async () => {
  expect(await signUp('u-alice', 'alice')).toBe('created')
  expect(await takeForCommunity('alice', 'c-1')).toBe('taken')
  expect(await handleAvailability(database, h('alice'), NOW)).toBe('taken')
  expect(await readOwnerHandle(database, community('c-1'))).toBeNull()
  expect(
    await readOwnerHandle(database, { kind: 'person', id: 'u-alice' }),
  ).toBe('alice')
  expect(handleRefusalText('ja', 'taken')).toBe(
    'このハンドルは、すでに使われています。',
  )
})

test('F30-AC2: Given a community uses a handle, When a person signs up with it, Then it is refused as taken and no account or profile is made', async () => {
  expect(await takeForCommunity('hono', 'c-1')).toBe('claimed')
  expect(await signUp('u-bob', 'hono')).toBe('handle_taken')
  expect(await db.$count(accounts)).toBe(0)
  expect(await db.$count(profiles)).toBe(0)
  expect(await readOwnerHandle(database, community('c-1'))).toBe('hono')
})

test('F30-AC4: Given a person left, When others take their handle within 90 days, Then nobody can, and from 90 days on someone can', async () => {
  expect(await signUp('u-carol', 'carol')).toBe('created')
  await markAccountDeleted(database, { ownerUserId: 'u-carol', now: NOW })
  expect(await db.$count(handles)).toBe(0)
  const justBefore = NOW + HANDLE_HOLD_SECONDS - 1
  expect(await handleAvailability(database, h('carol'), justBefore)).toBe(
    'held',
  )
  expect(await signUp('u-dave', 'carol', justBefore)).toBe('handle_held')
  expect(await takeForCommunity('carol', 'c-1', justBefore)).toBe('held')
  // Nothing of the refused sign-up stays behind.
  expect(await db.$count(accounts)).toBe(0)
  expect(await db.$count(profiles)).toBe(0)
  expect(await db.$count(handles)).toBe(0)
  const after = NOW + HANDLE_HOLD_SECONDS
  expect(await handleAvailability(database, h('carol'), after)).toBe(
    'available',
  )
  expect(await signUp('u-dave', 'carol', after)).toBe('created')
})

test('F30-AC4: Given a person left and signs in again, When they choose their old handle within 90 days, Then they cannot either', async () => {
  expect(await signUp('u-erin', 'erin')).toBe('created')
  await markAccountDeleted(database, { ownerUserId: 'u-erin', now: NOW })
  expect(await signUp('u-erin', 'erin', NOW + 60)).toBe('handle_held')
})

test('F30-AC5: Given two people and a community, When all take one handle at the same moment, Then exactly one gets it', async () => {
  await seedPerson(database, 'u-1')
  await seedPerson(database, 'u-2')
  const results = await Promise.all([
    createAccount(database, {
      userId: 'u-1',
      handle: h('race'),
      displayName: 'one',
      now: NOW,
    }),
    createAccount(database, {
      userId: 'u-2',
      handle: h('race'),
      displayName: 'two',
      now: NOW,
    }),
    takeForCommunity('race', 'c-1'),
  ])
  expect(
    results.filter((r) => r === 'created' || r === 'claimed'),
  ).toHaveLength(1)
  expect(
    results.filter((r) => r === 'handle_taken' || r === 'taken'),
  ).toHaveLength(2)
  expect(
    await db.select().from(handles).where(eq(handles.handle, 'race')),
  ).toHaveLength(1)
  // The winner's own rows only: the others made no account or profile.
  expect(await db.$count(accounts)).toBe(
    results[0] === 'created' || results[1] === 'created' ? 1 : 0,
  )
  expect(await db.$count(profiles)).toBe(await db.$count(accounts))
})

test('F30-AC8: Given a community let its handle go, When it is taken within 90 days, Then nobody can, and from 90 days on someone can', async () => {
  expect(await takeForCommunity('kanagawapm', 'c-1')).toBe('claimed')
  await db.batch(releaseHandleSteps(db, { owner: community('c-1'), now: NOW }))
  expect(await readOwnerHandle(database, community('c-1'))).toBeNull()
  expect(await signUp('u-fay', 'kanagawapm', NOW + 1)).toBe('handle_held')
  expect(await takeForCommunity('kanagawapm', 'c-2', NOW + 1)).toBe('held')
  expect(
    await takeForCommunity('kanagawapm', 'c-2', NOW + HANDLE_HOLD_SECONDS),
  ).toBe('claimed')
})

test('F30-AC4: Given a handle let go of twice, When it is checked, Then the later release starts the 90 days again', async () => {
  expect(await takeForCommunity('twice', 'c-1')).toBe('claimed')
  await db.batch(releaseHandleSteps(db, { owner: community('c-1'), now: NOW }))
  const later = NOW + HANDLE_HOLD_SECONDS
  expect(await takeForCommunity('twice', 'c-2', later)).toBe('claimed')
  await db.batch(
    releaseHandleSteps(db, { owner: community('c-2'), now: later }),
  )
  expect(await db.select().from(releasedHandles)).toEqual([
    {
      handle: 'twice',
      released_at: later,
      moved_to_kind: null,
      moved_to_id: null,
    },
  ])
  expect(await handleAvailability(database, h('twice'), later + 1)).toBe('held')
})

test('F30-AC43: Given a held handle, When the reason is shown, Then it says the handle cannot be chosen for 90 days, in both languages', () => {
  expect(handleRefusalText('ja', 'held')).toContain('90 日')
  expect(handleRefusalText('en', 'held')).toContain('90 days')
})

test('Given a held handle, When a community takes it with its own rows, Then none of its rows is written', async () => {
  await db.insert(releasedHandles).values({ handle: 'held', released_at: NOW })
  const owner = community('c-1')
  expect(
    await takeHandle(database, {
      handle: h('held'),
      owner,
      now: NOW + 1,
      rest: [
        sql`INSERT INTO ${releasedHandles} (handle, released_at)
          SELECT 'marker', 1 WHERE ${ownsHandle(h('held'), owner)}`,
      ],
    }),
  ).toBe('held')
  expect(await db.$count(releasedHandles)).toBe(1)
})

test('Given an owner that already holds a handle, When it takes another, Then it fails and keeps the first', async () => {
  expect(await takeForCommunity('first', 'c-1')).toBe('claimed')
  await expect(takeForCommunity('second', 'c-1')).rejects.toThrow()
  expect(await handleAvailability(database, h('second'), NOW)).toBe('available')
  expect(await readOwnerHandle(database, community('c-1'))).toBe('first')
})

test('Given a precondition that fails, When the handle is taken, Then nothing is written and the handle stays available', async () => {
  expect(
    await takeHandle(database, {
      handle: h('free'),
      owner: community('c-1'),
      now: NOW,
      precondition: sql`0`,
      rest: [],
    }),
  ).toBe('available')
  expect(await db.$count(handles)).toBe(0)
})

test('Given a statement after the claim that fails for its own reason, When the handle is taken, Then the error is not hidden and the handle stays free', async () => {
  await expect(
    takeHandle(database, {
      handle: h('broken'),
      owner: community('c-1'),
      now: NOW,
      rest: [sql`INSERT INTO no_such_table VALUES (1)`],
    }),
  ).rejects.toThrow()
  expect(await handleAvailability(database, h('broken'), NOW)).toBe('available')
})
