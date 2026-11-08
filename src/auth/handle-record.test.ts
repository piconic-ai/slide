import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { accounts } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import server from '../../server'
import {
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = testEnv(platform.env)

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db))
afterAll(() => platform.dispose())

const handles = async () =>
  orm
    .select({ user_id: accounts.user_id, handle: accounts.handle })
    .from(accounts)

test('Given no account, When the owner signs in, Then the lowercase GitHub login becomes the handle', async () => {
  await signIn(env)
  expect(await handles()).toEqual([{ user_id: '722500', handle: 'owner' }])
})

test('Given the owner signs in again under a renamed GitHub login, When handles are read, Then the first handle stays', async () => {
  await orm
    .insert(accounts)
    .values({ user_id: '722500', handle: 'first', created_at: 1 })
  await signIn(env)
  expect(await handles()).toEqual([{ user_id: '722500', handle: 'first' }])
})

test('Given a login that cannot be a handle, When the owner signs in, Then sign-in succeeds without a handle', async () => {
  expect(await signIn(env, 'not a handle')).toMatch(/^__Host-slide_owner=/)
  expect(await handles()).toEqual([])
})

test('Given another account already holds the handle, When the owner signs in, Then sign-in succeeds and the handle stays with its holder', async () => {
  await orm
    .insert(accounts)
    .values({ user_id: '1', handle: 'owner', created_at: 1 })
  expect(await signIn(env)).toMatch(/^__Host-slide_owner=/)
  expect(await handles()).toEqual([{ user_id: '1', handle: 'owner' }])
})

test('Given an account with a handle, When the owner deletes the account, Then the handle is dropped with it', async () => {
  const cookie = await signIn(env)
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/account/delete`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ confirm: 'owner' }),
    }),
    env,
  )
  expect(response.status).toBe(303)
  expect(await handles()).toEqual([])
})
