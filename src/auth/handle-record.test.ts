import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
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
const env = testEnv(platform.env)

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db))
afterAll(() => platform.dispose())

const handles = async () =>
  (await db.prepare('SELECT user_id, handle FROM accounts').all()).results

test('Given no account, When the owner signs in, Then the lowercase GitHub login becomes the handle', async () => {
  await signIn(env)
  expect(await handles()).toEqual([{ user_id: '722500', handle: 'owner' }])
})

test('Given the owner signs in again under a renamed GitHub login, When handles are read, Then the first handle stays', async () => {
  await db.prepare("INSERT INTO accounts VALUES ('722500', 'first', 1)").run()
  await signIn(env)
  expect(await handles()).toEqual([{ user_id: '722500', handle: 'first' }])
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
