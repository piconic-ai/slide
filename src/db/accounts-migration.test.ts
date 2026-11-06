import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
afterAll(() => platform.dispose())

test('Given owners signed in before handles, When accounts are migrated, Then each keeps a lowercase handle and bad handles are refused', async () => {
  const db = platform.env.DB
  await applyMigrations(db, { until: '0009_deck_deletion.sql' })
  await db
    .prepare(
      "INSERT INTO owner_sessions VALUES ('h1', '722500', 'KFly8', 10, 20)",
    )
    .run()
  await applyMigrations(db, { after: '0009_deck_deletion.sql' })
  const rows = await db.prepare('SELECT * FROM accounts').all()
  expect(rows.results).toEqual([
    { user_id: '722500', handle: 'kfly8', created_at: 10 },
  ])
  for (const handle of ['Upper', '-lead', 'a_b', '', 'a'.repeat(40)])
    await expect(
      db
        .prepare("INSERT INTO accounts VALUES ('other', ?, 1)")
        .bind(handle)
        .run(),
    ).rejects.toThrow()
})
