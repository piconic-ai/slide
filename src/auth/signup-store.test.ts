import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { authSession, authUser, authVerification } from '../db/auth-schema'
import { accounts, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { resetTables } from '../publication/test-support'
import { sweepSignups } from './signup-store'
import { SWEEP_LIMIT } from './signup-sweep'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)
const NOW = 2_000_000
const DAY = 24 * 60 * 60

beforeAll(() => applyMigrations(database))
beforeEach(() => resetTables(database))
afterAll(() => platform.dispose())

/** A user made `age` seconds before NOW, with a session and a code. */
async function person(id: string, age: number, sessionAge = age) {
  const made = new Date((NOW - age) * 1000)
  const signedIn = new Date((NOW - sessionAge) * 1000)
  await orm.insert(authUser).values({
    id,
    name: '',
    email: `${id}@mail.example`,
    emailVerified: true,
    createdAt: made,
    updatedAt: made,
  })
  await orm.insert(authSession).values({
    id: `s-${id}`,
    token: `t-${id}`,
    userId: id,
    expiresAt: new Date((NOW + DAY) * 1000),
    createdAt: signedIn,
    updatedAt: signedIn,
  })
  await orm.insert(authVerification).values({
    id: `v-${id}`,
    identifier: `sign-in-otp-${id}@mail.example`,
    value: 'x',
    expiresAt: new Date((NOW + 600) * 1000),
    createdAt: made,
    updatedAt: made,
  })
}
const users = async () =>
  (await orm.select({ id: authUser.id }).from(authUser)).map((r) => r.id).sort()

test('F28-AC71: Given users made 24 hours ago exactly, a second less and a second more, When the sweep runs, Then the first and the last go with their sessions and codes', async () => {
  await person('exact', DAY)
  await person('under', DAY - 1)
  await person('over', DAY + 1)
  const swept = await sweepSignups(database, NOW)
  expect(swept.users).toBe(2)
  expect(await users()).toEqual(['under'])
  expect((await orm.select().from(authSession)).map((r) => r.userId)).toEqual([
    'under',
  ])
  expect((await orm.select().from(authVerification)).map((r) => r.id)).toEqual([
    'v-under',
  ])
})

test('F28-AC69: Given an old user with an account and an old suspended user with none, When the sweep runs, Then both stay', async () => {
  await person('member', 5 * DAY)
  await person('banned', 5 * DAY)
  await person('gone', 5 * DAY)
  await orm
    .insert(accounts)
    .values({ user_id: 'member', handle: 'member', created_at: 1 })
  await orm.insert(suspensions).values({
    user_id: 'banned',
    reason: 'r',
    suspended_at: 1,
    suspended_by: 'op',
  })
  await sweepSignups(database, NOW)
  expect(await users()).toEqual(['banned', 'member'])
  expect(
    (await orm.select().from(authSession)).map((r) => r.userId).sort(),
  ).toEqual(['banned', 'member'])
})

test('F28-AC67: Given a code that ran out and one that has not, When the sweep runs, Then only the first goes', async () => {
  await person('a', 100)
  await orm.insert(authVerification).values({
    id: 'old',
    identifier: 'sign-in-otp-old@mail.example',
    value: 'x',
    expiresAt: new Date((NOW - 1) * 1000),
    createdAt: new Date(1),
    updatedAt: new Date(1),
  })
  const swept = await sweepSignups(database, NOW)
  expect(swept.codes).toBe(1)
  expect((await orm.select().from(authVerification)).map((r) => r.id)).toEqual([
    'v-a',
  ])
})

test('F28-AC72: Given a user made days ago who signed in again an hour ago, and one whose latest sign-in was exactly 24 hours ago, When the sweep runs, Then the first stays and the second goes', async () => {
  await person('again', 5 * DAY, 3600)
  await person('idle', 5 * DAY, DAY)
  await sweepSignups(database, NOW)
  expect(await users()).toEqual(['again'])
})

test('F28-AC74: Given more stale users than one run takes, When the sweep runs twice, Then the first run takes the limit and the second the rest', async () => {
  for (let i = 0; i < SWEEP_LIMIT + 5; i++) await person(`u${i}`, 3 * DAY + i)
  expect((await sweepSignups(database, NOW)).users).toBe(SWEEP_LIMIT)
  expect(await users()).toHaveLength(5)
  expect((await sweepSignups(database, NOW)).users).toBe(5)
  expect(await users()).toEqual([])
})
