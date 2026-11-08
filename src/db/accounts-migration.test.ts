import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { accounts } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
afterAll(() => platform.dispose())

test('Given owners signed in before handles, When accounts are migrated, Then each keeps a lowercase handle, and only valid handles are accepted', async () => {
  const database = platform.env.DB
  const db = drizzle(database)
  await applyMigrations(database, { until: '0009_deck_deletion.sql' })
  await db.run(
    sql`INSERT INTO owner_sessions VALUES ('h1', '722500', 'KFly8', 10, 20)`,
  )
  await applyMigrations(database, { after: '0009_deck_deletion.sql' })
  const rows = await db.select().from(accounts)
  expect(rows).toEqual([{ user_id: '722500', handle: 'kfly8', created_at: 10 }])
  for (const [index, handle] of ['a-b', 'a', 'a'.repeat(39), 'a-'].entries())
    await db
      .insert(accounts)
      .values({ user_id: `ok-${index}`, handle, created_at: 1 })
  for (const handle of ['Upper', '-lead', 'a_b', '', 'a'.repeat(40)])
    await expect(
      db.insert(accounts).values({ user_id: 'other', handle, created_at: 1 }),
    ).rejects.toThrow()
})
