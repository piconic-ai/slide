import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { accounts, handles, releasedHandles } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

beforeAll(async () => {
  await applyMigrations(database, { until: '0048_gravatar_checked_at.sql' })
  // The second scope's last state: people with handles.
  await db.insert(accounts).values([
    { user_id: 'u-kfly8', handle: 'kfly8', created_at: 10 },
    { user_id: 'u-alice', handle: 'alice', created_at: 20 },
    { user_id: 'u-max', handle: 'a'.repeat(39), created_at: 30 },
  ])
  await applyMigrations(database, { after: '0048_gravatar_checked_at.sql' })
})
afterAll(() => platform.dispose())

test('F30-AC6: Given people with handles before 0049, When the shared handles are migrated, Then each handle is held by the same person and their account is kept', async () => {
  expect(await db.select().from(handles).orderBy(handles.created_at)).toEqual([
    {
      handle: 'kfly8',
      owner_kind: 'person',
      owner_id: 'u-kfly8',
      created_at: 10,
    },
    {
      handle: 'alice',
      owner_kind: 'person',
      owner_id: 'u-alice',
      created_at: 20,
    },
    {
      handle: 'a'.repeat(39),
      owner_kind: 'person',
      owner_id: 'u-max',
      created_at: 30,
    },
  ])
  expect(await db.select().from(accounts)).toHaveLength(3)
  expect(await db.select().from(releasedHandles)).toEqual([])
})

test('F30-AC5: Given migration 0049, When the previous Worker makes an account, Then the handle is held for that person too', async () => {
  await db.run(
    sql`INSERT INTO accounts (user_id, handle, created_at) VALUES ('u-old', 'old-worker', 40)`,
  )
  expect(
    await db.all(
      sql`SELECT owner_kind, owner_id FROM handles WHERE handle = 'old-worker'`,
    ),
  ).toEqual([{ owner_kind: 'person', owner_id: 'u-old' }])
})

test('F30-AC2 F30-AC5: Given a community holds a handle, When the previous Worker makes an account with it, Then the account is refused', async () => {
  await db.insert(handles).values({
    handle: 'hono',
    owner_kind: 'community',
    owner_id: 'c-1',
    created_at: 50,
  })
  await expect(
    db.run(
      sql`INSERT INTO accounts (user_id, handle, created_at) VALUES ('u-hono', 'hono', 60)`,
    ),
  ).rejects.toThrow()
  expect(
    await db.all(sql`SELECT user_id FROM accounts WHERE handle = 'hono'`),
  ).toEqual([])
})

test.each(['Upper', '-lead', 'a_b', '', 'a'.repeat(40)])(
  'Given migration 0049, When %j is written as a handle, Then it is refused',
  async (handle) => {
    await expect(
      db.insert(handles).values({
        handle,
        owner_kind: 'community',
        owner_id: `c-${handle}`,
        created_at: 1,
      }),
    ).rejects.toThrow()
  },
)

test('Given migration 0049, When an owner would hold a second handle, Then it is refused', async () => {
  await expect(
    db.insert(handles).values({
      handle: 'kfly8-two',
      owner_kind: 'person',
      owner_id: 'u-kfly8',
      created_at: 1,
    }),
  ).rejects.toThrow()
})

test('Given migration 0049, When a released handle names only half of where it moved, Then it is refused', async () => {
  await expect(
    db
      .insert(releasedHandles)
      .values({ handle: 'gone', released_at: 1, moved_to_kind: 'person' }),
  ).rejects.toThrow()
  await expect(
    db
      .insert(releasedHandles)
      .values({ handle: 'gone', released_at: 1, moved_to_id: 'u-kfly8' }),
  ).rejects.toThrow()
})

test('F30-AC4 F30-AC7: Given a handle let go of a minute ago, When the previous Worker makes an account with it, Then the account is refused and nothing is held for it', async () => {
  await db.insert(releasedHandles).values({
    handle: 'just-gone',
    released_at: Math.floor(Date.now() / 1000) - 60,
  })
  await expect(
    db.run(
      sql`INSERT INTO accounts (user_id, handle, created_at) VALUES ('u-early', 'just-gone', 70)`,
    ),
  ).rejects.toMatchObject({
    cause: { message: expect.stringContaining('handle_held') },
  })
  expect(
    await db.all(sql`SELECT user_id FROM accounts WHERE handle = 'just-gone'`),
  ).toEqual([])
  expect(
    await db.all(sql`SELECT owner_id FROM handles WHERE handle = 'just-gone'`),
  ).toEqual([])
})

test('F30-AC4: Given a handle let go of more than 90 days ago, When the previous Worker makes an account with it, Then the account is made and holds the handle', async () => {
  await db.insert(releasedHandles).values({
    handle: 'long-gone',
    released_at: Math.floor(Date.now() / 1000) - 91 * 24 * 60 * 60,
  })
  await db.run(
    sql`INSERT INTO accounts (user_id, handle, created_at) VALUES ('u-late', 'long-gone', 80)`,
  )
  expect(
    await db.all(sql`SELECT owner_id FROM handles WHERE handle = 'long-gone'`),
  ).toEqual([{ owner_id: 'u-late' }])
})
