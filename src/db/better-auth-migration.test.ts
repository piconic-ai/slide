import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from './test-migrations'
const platform = await getPlatformProxy<Env>({ persist: false })
afterAll(() => platform.dispose())
test('Given legacy owner sessions and decks, When Better Auth migration runs, Then deck ownership and fixed handles survive while old browser sessions are discarded', async () => {
  const db = platform.env.DB
  await applyMigrations(db, { until: '0011_deployment_titles.sql' })
  await db.batch([
    db.prepare("INSERT INTO accounts VALUES ('722500', 'fixed-handle', 1)"),
    db.prepare(
      "INSERT INTO decks (id, owner_user_id, created_at) VALUES ('talk', '722500', 1)",
    ),
    db.prepare(
      "INSERT INTO owner_sessions VALUES ('legacy-token', '722500', 'old-login', 1, 2)",
    ),
  ])
  await applyMigrations(db, { after: '0011_deployment_titles.sql' })
  expect(
    await db.prepare('SELECT user_id, handle FROM accounts').first(),
  ).toEqual({ user_id: '722500', handle: 'fixed-handle' })
  expect(await db.prepare('SELECT owner_user_id FROM decks').first()).toEqual({
    owner_user_id: '722500',
  })
  expect(
    await db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'owner_sessions'")
      .first(),
  ).toBeNull()
  expect(
    (await db.prepare('SELECT COUNT(*) AS n FROM auth_session').first())?.n,
  ).toBe(0)
})
