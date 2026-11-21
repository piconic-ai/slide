import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../src/app/routes'
import { applyMigrations } from '../src/db/test-migrations'
import { ownerSessionSql, signOwnerCookie } from './owner-cookie.mjs'

const SECRET = 'test-only-better-auth-secret-32-bytes-long'
const ORIGIN = 'https://slide.example'
const platform = await getPlatformProxy({ persist: false })
const db = drizzle(platform.env.DB)
const env = {
  ...platform.env,
  GITHUB_APP_CLIENT_ID: 'Iv1.client',
  GITHUB_APP_CLIENT_SECRET: 'secret',
  BETTER_AUTH_SECRET: SECRET,
  PUBLIC_ORIGIN: ORIGIN,
}
const token = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'

/** Runs the statements as wrangler d1 execute would run the file. */
async function execute(statements) {
  for (const statement of statements.split(';'))
    if (statement.trim()) await db.run(sql.raw(statement))
}
const whoAmI = (cookie) =>
  server.fetch(
    new Request(`${ORIGIN}/auth/owner`, { headers: { Cookie: cookie } }),
    env,
  )

beforeAll(() => applyMigrations(platform.env.DB))
beforeEach(() =>
  db.batch([
    db.run(sql`DELETE FROM auth_session`),
    db.run(sql`DELETE FROM auth_account`),
    db.run(sql`DELETE FROM auth_user`),
  ]),
)
afterAll(() => platform.dispose())

test('Given the session rows in a local D1, When the signed cookie is sent to the Worker, Then the Worker takes it as the registered author', async () => {
  await execute(
    ownerSessionSql({
      githubId: '722500',
      name: 'kfly8',
      token,
      now: Date.now(),
    }),
  )

  const response = await whoAmI(signOwnerCookie(token, SECRET))

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ userId: '722500', login: 'kfly8' })
})

test('Given the session was made twice, When the second cookie is sent, Then it works and the first no longer does', async () => {
  const second = 'ffffffffffffffffffffffffffffffff'
  const rows = (value) =>
    ownerSessionSql({
      githubId: '722500',
      name: 'kfly8',
      token: value,
      now: Date.now(),
    })
  await execute(rows(token))
  await execute(rows(second))

  expect((await whoAmI(signOwnerCookie(second, SECRET))).status).toBe(200)
  expect((await whoAmI(signOwnerCookie(token, SECRET))).status).toBe(401)
})

test('Given the author signed in through GitHub before, When a local session is made, Then it belongs to the user they already have', async () => {
  await db.run(sql`INSERT INTO auth_user (id,name,email,email_verified,created_at,updated_at)
    VALUES ('real-user','kfly8','722500@users.noreply.github.com',0,1,1)`)
  await db.run(sql`INSERT INTO auth_account (id,account_id,provider_id,user_id,created_at,updated_at)
    VALUES ('real-account','722500','github','real-user',1,1)`)

  await execute(
    ownerSessionSql({
      githubId: '722500',
      name: 'other',
      token,
      now: Date.now(),
    }),
  )

  expect(await db.all(sql`SELECT user_id FROM auth_session`)).toEqual([
    { user_id: 'real-user' },
  ])
  expect((await whoAmI(signOwnerCookie(token, SECRET))).status).toBe(200)
})

test.each([['a cookie signed with another secret', 'x'.repeat(40)]])(
  'Given %s, When it is sent to the Worker, Then it is not signed in',
  async (_, secret) => {
    await execute(
      ownerSessionSql({
        githubId: '722500',
        name: 'kfly8',
        token,
        now: Date.now(),
      }),
    )

    expect((await whoAmI(signOwnerCookie(token, secret))).status).toBe(401)
  },
)

test('Given someone who is not a registered author, When their cookie is sent, Then the Worker does not sign them in', async () => {
  await execute(
    ownerSessionSql({
      githubId: '999999999',
      name: 'stranger',
      token,
      now: Date.now(),
    }),
  )

  expect((await whoAmI(signOwnerCookie(token, SECRET))).status).toBe(401)
})

test('Given a name with a quote, When the SQL is made, Then the quote is doubled and the statement still runs', async () => {
  await execute(
    ownerSessionSql({
      githubId: '722500',
      name: "o'brien",
      token,
      now: Date.now(),
    }),
  )

  expect(await db.all(sql`SELECT name FROM auth_user`)).toEqual([
    { name: "o'brien" },
  ])
})

test.each([
  ['a GitHub ID that is not a number', { githubId: "1' OR '1'='1" }],
  ['an empty GitHub ID', { githubId: '' }],
  ['a token with a quote', { token: "abcdefghijklmnop'" }],
  ['a short token', { token: 'short' }],
  ['a time that is not a number', { now: '2026-11-20' }],
])('Given %s, When the SQL is made, Then it throws', (_, change) => {
  expect(() =>
    ownerSessionSql({
      githubId: '722500',
      name: 'kfly8',
      token,
      now: 1,
      ...change,
    }),
  ).toThrow()
})

test.each([undefined, '', 'too-short'])(
  'Given the secret %j, When a cookie is signed, Then it throws',
  (secret) => {
    expect(() => signOwnerCookie(token, secret)).toThrow()
  },
)
