import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { count, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { applyMigrations } from './test-migrations'
import { accounts, decks } from './schema'
import { authSession } from './auth-schema'
const platform = await getPlatformProxy<Env>({ persist: false })
afterAll(() => platform.dispose())
test('Given legacy owner sessions and decks, When Better Auth migration runs, Then deck ownership and fixed handles survive while old session rows are cleared, and the rollback schema stays until 0038 drops it', async () => {
  const database = platform.env.DB
  const db = drizzle(database)
  await applyMigrations(database, { until: '0011_deployment_titles.sql' })
  await db.batch([
    db.run(
      sql`INSERT INTO accounts (user_id, handle, created_at) VALUES ('722500', 'fixed-handle', 1)`,
    ),
    // Raw SQL: the query builder names columns the old schema lacks.
    db.run(sql`INSERT INTO decks (id, owner_user_id, created_at)
      VALUES ('talk', '722500', 1)`),
    db.run(sql`INSERT INTO owner_sessions
      (token_hash, github_user_id, github_login, created_at, expires_at)
      VALUES ('legacy-token', '722500', 'old-login', 1, 2)`),
  ])
  await applyMigrations(database, {
    after: '0011_deployment_titles.sql',
    until: '0037_profiles_without_github.sql',
  })
  expect(
    await db
      .select({ user_id: accounts.user_id, handle: accounts.handle })
      .from(accounts)
      .get(),
  ).toEqual({ user_id: '722500', handle: 'fixed-handle' })
  expect(
    await db.select({ owner_user_id: decks.owner_user_id }).from(decks).get(),
  ).toEqual({
    owner_user_id: '722500',
  })
  expect(
    await db.get(
      sql`SELECT name FROM sqlite_master WHERE name = 'owner_sessions'`,
    ),
  ).toEqual({ name: 'owner_sessions' })
  expect(
    (await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM owner_sessions`))
      ?.n,
  ).toBe(0)
  expect((await db.select({ n: count() }).from(authSession).get())?.n).toBe(0)
  await applyMigrations(database, { after: '0037_profiles_without_github.sql' })
  expect(
    await db.get(
      sql`SELECT name FROM sqlite_master WHERE name = 'owner_sessions'`,
    ),
  ).toBeUndefined()
})
