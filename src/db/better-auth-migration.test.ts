import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { count, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { applyMigrations } from './test-migrations'
import { accounts, decks } from './schema'
import { authSession } from './auth-schema'
const platform = await getPlatformProxy<Env>({ persist: false })
afterAll(() => platform.dispose())
test('Given legacy owner sessions and decks, When Better Auth migration runs, Then deck ownership and fixed handles survive while old session rows are cleared and the rollback schema remains', async () => {
  const database = platform.env.DB
  const db = drizzle(database)
  await applyMigrations(database, { until: '0011_deployment_titles.sql' })
  await db.batch([
    db
      .insert(accounts)
      .values({ user_id: '722500', handle: 'fixed-handle', created_at: 1 }),
    db
      .insert(decks)
      .values({ id: 'talk', owner_user_id: '722500', created_at: 1 }),
    db.run(sql`INSERT INTO owner_sessions
      (token_hash, github_user_id, github_login, created_at, expires_at)
      VALUES ('legacy-token', '722500', 'old-login', 1, 2)`),
  ])
  await applyMigrations(database, { after: '0011_deployment_titles.sql' })
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
})
