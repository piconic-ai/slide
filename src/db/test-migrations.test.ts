import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { accounts } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = drizzle(platform.env.DB)
afterAll(() => platform.dispose())

test('Given a migration whose second statement fails, When applied as one batch, Then the first statement is rolled back', async () => {
  const failing = new Proxy(platform.env.DB, {
    get(target, property) {
      if (property === 'prepare')
        return (query: string) =>
          target.prepare(
            query.includes('CREATE TABLE upload_files')
              ? 'CREATE TABLE deployments (duplicate TEXT)'
              : query,
          )
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  await expect(
    applyMigrations(failing, { until: '0001_uploads.sql' }),
  ).rejects.toThrow()
  expect(
    await db.all(sql`SELECT name FROM sqlite_master WHERE type = 'table'`),
  ).toEqual([])
})

test('Given ordered migration files, When an inclusive upper bound and exclusive lower bound are used, Then adjacent ranges compose without replaying files', async () => {
  await applyMigrations(platform.env.DB, { until: '0001_uploads.sql' })
  expect(await db.all(sql`PRAGMA table_info(deployments)`)).not.toEqual([])
  expect(
    await db.all(
      sql`SELECT name FROM sqlite_master WHERE name = 'deployments_unswept'`,
    ),
  ).toEqual([])
  await applyMigrations(platform.env.DB, {
    after: '0001_uploads.sql',
    until: '0003_upload_sweeps.sql',
  })
  expect(
    await db.get(
      sql`SELECT name FROM sqlite_master WHERE name = 'deployments_unswept'`,
    ),
  ).toEqual({ name: 'deployments_unswept' })
  await applyMigrations(platform.env.DB, { after: '0003_upload_sweeps.sql' })
  await db
    .insert(accounts)
    .values({ user_id: 'range', handle: 'range', created_at: 1 })
  await applyMigrations(platform.env.DB, {
    after: '0012_better_auth.sql',
    until: '0012_better_auth.sql',
  })
  expect(await db.select().from(accounts)).toEqual([
    { user_id: 'range', handle: 'range', created_at: 1 },
  ])
})

test('Given Drizzle 0.45.4 on D1, When raw statements are batched, Then parameterless SQL mixes with typed builders but parameterized raw SQL is rejected before writes', async () => {
  await db.batch([
    db.run(sql`INSERT INTO accounts VALUES ('raw', 'raw', 1)`),
    db
      .insert(accounts)
      .values({ user_id: 'typed', handle: 'typed', created_at: 1 }),
  ])
  await expect(
    db.batch([
      db
        .insert(accounts)
        .values({ user_id: 'unwritten', handle: 'unwritten', created_at: 1 }),
      db.run(
        sql`INSERT INTO accounts VALUES (${'parameter'}, ${'parameter'}, ${1})`,
      ),
    ]),
  ).rejects.toThrow(/bind/)
  expect(
    (await db.select().from(accounts)).map((row) => row.user_id).sort(),
  ).toEqual(['range', 'raw', 'typed'])
})
