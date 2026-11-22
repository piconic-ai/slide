import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { authSession, authUser, authVerification } from '../db/auth-schema'
import { accounts, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { resetTables } from '../publication/test-support'
import { sweepSignups } from './signup-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)
const NOW = 2_000_000
const DAY = 24 * 60 * 60

beforeAll(() => applyMigrations(database))
beforeEach(() => resetTables(database))
afterAll(() => platform.dispose())

/** A user made `age` seconds before NOW, with a session and a code. */
async function person(id: string, age: number) {
  const made = new Date((NOW - age) * 1000)
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
    createdAt: made,
    updatedAt: made,
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

test('F28-AC68: Given users made 24 hours ago exactly, a second less and a second more, When the sweep runs, Then the first and the last go with their sessions and codes', async () => {
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
