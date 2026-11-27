import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import {
  accounts,
  follows,
  mutes,
  profilePictures,
  profiles,
  suspensions,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { resetTables } from '../publication/test-support'
import { PEOPLE_PER_PAGE } from './people'
import { countPeople, listPeople, unfollow, type PeopleQuery } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const [alice, bob, carol, dave] = ['1', '2', '3', '4']

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await db.insert(accounts).values([
    { user_id: alice, handle: 'alice', created_at: 1 },
    { user_id: bob, handle: 'bob', created_at: 1 },
    { user_id: carol, handle: 'carol', created_at: 1 },
    { user_id: dave, handle: 'dave', created_at: 1 },
  ])
})
afterAll(() => platform.dispose())

const followAt = (follower: string, followee: string, at: number) =>
  db.insert(follows).values({
    follower_user_id: follower,
    followee_user_id: followee,
    created_at: at,
  })

const suspend = (userId: string) =>
  db.insert(suspensions).values({
    user_id: userId,
    reason: 'test',
    suspended_at: 1,
    suspended_by: 'operator',
  })

const muteBy = (muter: string, muted: string) =>
  db
    .insert(mutes)
    .values({ muter_user_id: muter, muted_user_id: muted, created_at: 1 })

/** The handles a reader sees in a list, and the count beside it. */
async function shown(query: PeopleQuery) {
  const [people, count] = await Promise.all([
    listPeople(database, { ...query, limit: PEOPLE_PER_PAGE, offset: 0 }),
    countPeople(database, query),
  ])
  return { handles: people.map((person) => person.handle), count }
}

const anyone = (of: string, list: PeopleQuery['list']) =>
  shown({ of, list, viewer: null })

test('F21-AC8: Given Alice and Bob follow each other and Carol follows Alice, When anyone reads the lists, Then each direction lists its own people', async () => {
  await followAt(alice, bob, 10)
  await followAt(bob, alice, 20)
  await followAt(carol, alice, 30)
  expect(await anyone(alice, 'following')).toEqual({
    handles: ['bob'],
    count: 1,
  })
  expect(await anyone(alice, 'followers')).toEqual({
    handles: ['carol', 'bob'],
    count: 2,
  })
  expect(await anyone(bob, 'followers')).toEqual({
    handles: ['alice'],
    count: 1,
  })
  expect(await anyone(carol, 'followers')).toEqual({ handles: [], count: 0 })
})

test('F21-AC8: Given a person with a profile and one without, When the list is read, Then each comes with the name they have', async () => {
  await followAt(alice, bob, 10)
  await followAt(alice, carol, 20)
  await db.insert(profiles).values([{ user_id: bob, name: 'Bob <b>' }])
  expect(
    await listPeople(database, {
      of: alice,
      list: 'following',
      viewer: null,
      limit: 10,
      offset: 0,
    }),
  ).toEqual([
    {
      userId: carol,
      handle: 'carol',
      name: null,
      avatarUrl: `/avatars/${carol}?v=g`,
      followedByViewer: false,
      followsViewer: false,
    },
    {
      userId: bob,
      handle: 'bob',
      name: 'Bob <b>',
      avatarUrl: `/avatars/${bob}?v=g`,
      followedByViewer: false,
      followsViewer: false,
    },
  ])
})

test('F28-AC101: Given people whose faces come from an upload, from Gravatar asked at a time, from Gravatar not yet asked, and from nothing, When the list is read, Then each address carries the version of that face', async () => {
  await followAt(alice, bob, 10)
  await followAt(alice, carol, 20)
  await followAt(alice, dave, 30)
  await followAt(dave, alice, 40)
  await db.insert(profiles).values([
    { user_id: bob, name: 'Bob', use_gravatar: 0 },
    { user_id: carol, name: 'Carol', gravatar_at: 700 },
    { user_id: dave, name: 'Dave', use_gravatar: 0 },
  ])
  // An upload wins over a Gravatar choice that is off.
  await db.insert(profilePictures).values({ user_id: bob, uploaded_at: 500 })
  const urls = async (of: string, list: PeopleQuery['list']) =>
    (
      await listPeople(database, {
        of,
        list,
        viewer: null,
        limit: 10,
        offset: 0,
      })
    ).map((person) => [person.handle, person.avatarUrl])
  expect(await urls(alice, 'following')).toEqual([
    ['dave', `/avatars/${dave}?v=n`],
    ['carol', `/avatars/${carol}?v=g700`],
    ['bob', `/avatars/${bob}?v=u500`],
  ])
  // A person who wrote no profile yet has Gravatar on, as everyone starts.
  expect(await urls(dave, 'following')).toEqual([
    ['alice', `/avatars/${alice}?v=g`],
  ])
})

test.each(['following', 'followers'] as const)(
  'F21-AC10: Given one person in the %s list is suspended and another has left, When anyone reads it, Then neither is listed nor counted',
  async (list) => {
    const link = (other: string, at: number) =>
      list === 'following'
        ? followAt(alice, other, at)
        : followAt(other, alice, at)
    await link(bob, 10)
    await link(carol, 20)
    await link(dave, 30)
    // A follow whose other side has no account, as after leaving.
    await link('gone', 40)
    await suspend(carol)
    expect(await anyone(alice, list)).toEqual({
      handles: ['dave', 'bob'],
      count: 2,
    })
    // A suspension that is lifted brings the person back.
    await db.delete(suspensions)
    expect((await anyone(alice, list)).handles).toEqual([
      'dave',
      'carol',
      'bob',
    ])
  },
)

test.each(['following', 'followers'] as const)(
  'F21-AC11: Given Dave muted Bob, When Dave reads Alice’s %s list, Then Bob is neither listed nor counted for Dave, and stays for everyone else',
  async (list) => {
    const link = (other: string, at: number) =>
      list === 'following'
        ? followAt(alice, other, at)
        : followAt(other, alice, at)
    await link(bob, 10)
    await link(carol, 20)
    await muteBy(dave, bob)
    // Bob muting Dave hides nothing from Dave.
    await muteBy(carol, dave)
    expect(await shown({ of: alice, list, viewer: dave })).toEqual({
      handles: ['carol'],
      count: 1,
    })
    for (const viewer of [null, alice, bob, carol])
      expect(await shown({ of: alice, list, viewer })).toEqual({
        handles: ['carol', 'bob'],
        count: 2,
      })
  },
)

test('F21-AC12: Given Alice follows Bob, When she unfollows him, Then he leaves her following list and she leaves his followers', async () => {
  await followAt(alice, bob, 10)
  await followAt(alice, carol, 20)
  await unfollow(database, { follower: alice, followee: bob })
  expect(await anyone(alice, 'following')).toEqual({
    handles: ['carol'],
    count: 1,
  })
  expect(await anyone(bob, 'followers')).toEqual({ handles: [], count: 0 })
})

test('F21-AC19: Given 51 followers, some following in the same second, When the list is read in pages of 50, Then the newest come first, nobody repeats and the last one is on the second page', async () => {
  const total = PEOPLE_PER_PAGE + 1
  const ids = Array.from({ length: total }, (_, index) => String(100 + index))
  // D1 takes at most 100 bound values in a statement.
  for (let start = 0; start < total; start += 25) {
    const some = ids.slice(start, start + 25)
    await db.batch([
      db
        .insert(accounts)
        .values(
          some.map((id) => ({ user_id: id, handle: `p${id}`, created_at: 1 })),
        ),
      db.insert(follows).values(
        some.map((id, index) => ({
          follower_user_id: id,
          followee_user_id: alice,
          // Pairs share a second, so the order needs its tie-breaker.
          created_at: 1000 + Math.floor((start + index) / 2),
        })),
      ),
    ])
  }
  const query = { of: alice, list: 'followers', viewer: null } as const
  const page = (offset: number) =>
    listPeople(database, { ...query, limit: PEOPLE_PER_PAGE, offset })
  const [first, second, third] = await Promise.all([
    page(0),
    page(PEOPLE_PER_PAGE),
    page(2 * PEOPLE_PER_PAGE),
  ])
  expect(first).toHaveLength(PEOPLE_PER_PAGE)
  expect(first[0]?.handle).toBe('p150')
  // The same second: the lower id first.
  expect(first.slice(1, 3).map((person) => person.handle)).toEqual([
    'p148',
    'p149',
  ])
  expect(second.map((person) => person.handle)).toEqual(['p101'])
  expect(third).toEqual([])
  expect(
    new Set([...first, ...second].map((person) => person.handle)).size,
  ).toBe(total)
  expect(await countPeople(database, query)).toBe(total)
})

test('F21-AC12: Given Dave follows Bob and not Carol, When Dave reads Alice’s following, Then each person says whether Dave follows them', async () => {
  await followAt(alice, bob, 10)
  await followAt(alice, carol, 20)
  await followAt(alice, dave, 30)
  await followAt(dave, bob, 40)
  // Bob following Dave is the other direction, and marks nobody.
  await followAt(carol, dave, 50)
  const read = async (viewer: string | null) =>
    (
      await listPeople(database, {
        of: alice,
        list: 'following',
        viewer,
        limit: 10,
        offset: 0,
      })
    ).map((person) => [person.handle, person.followedByViewer])
  expect(await read(dave)).toEqual([
    ['dave', false],
    ['carol', false],
    ['bob', true],
  ])
  expect(await read(null)).toEqual([
    ['dave', false],
    ['carol', false],
    ['bob', false],
  ])
})

test('F21-AC68: Given Bob follows Dave and Carol does not, When Dave reads Alice’s following, Then only Bob is marked as following Dave, and a visitor sees no mark', async () => {
  await followAt(alice, bob, 10)
  await followAt(alice, carol, 20)
  // Dave following Carol is the other direction, and marks nobody.
  await followAt(dave, carol, 30)
  await followAt(bob, dave, 40)
  const read = async (viewer: string | null) =>
    (
      await listPeople(database, {
        of: alice,
        list: 'following',
        viewer,
        limit: 10,
        offset: 0,
      })
    ).map((person) => [person.handle, person.followsViewer])
  expect(await read(dave)).toEqual([
    ['carol', false],
    ['bob', true],
  ])
  expect(await read(null)).toEqual([
    ['carol', false],
    ['bob', false],
  ])
})
