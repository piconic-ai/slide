import { readdirSync, readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from './test-migrations'

// The third scope's migrations (0053 and later) only add (D-04, D-07): they
// land on production's data from main (the second scope and what main added
// up to 0052), which they keep.

const LAST_OF_MAIN = '0052_related_link_sanitized_url.sql'

const scope3 = readdirSync('migrations')
  .filter((name) => name.endsWith('.sql') && name > LAST_OF_MAIN)
  .sort()

// The one migration that rebuilds a table: a CHECK constraint (the kinds a
// notification may have) cannot be altered, so notifications is rebuilt for
// community_published (F20-AC15). It copies every row first, and
// the test below it keeps those rows. The decision to depart from D-04 here
// is the requester's; docs/dev/f20-notifications.md says so.
const REBUILDS = {
  '0059_community_notifications.sql': [
    'DROP TABLE',
    'ALTER TABLE notifications_next RENAME',
  ],
} as const

// What would take away or rebuild a table or a column, comments left out.
const takesAway = (name: string) =>
  [
    ...readFileSync(`migrations/${name}`, 'utf8')
      .replace(/--.*$/gm, '')
      .matchAll(
        /\b(DROP\s+\w+|RENAME\b|ALTER\s+TABLE\s+\w+\s+(?!ADD\s+COLUMN\b)\w+|DELETE\s+FROM|TRUNCATE|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE)/gi,
      ),
  ].map(([statement]) => statement!.replace(/\s+/g, ' '))

test('D-04: Given the third scope migrations, When their statements are read, Then none drops, renames or rebuilds a table or a column but the listed rebuild', () => {
  expect(scope3[0]).toBe('0053_shared_handles.sql')
  expect(
    Object.fromEntries(scope3.map((name) => [name, takesAway(name)])),
  ).toEqual(
    Object.fromEntries(
      scope3.map((name) => [
        name,
        (REBUILDS as Record<string, readonly string[]>)[name] ?? [],
      ]),
    ),
  )
})

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

beforeAll(async () => {
  await applyMigrations(database, { until: LAST_OF_MAIN })
  // Main's last state: people, their slides, a related link of
  // a talk and a follow.
  await db.run(sql`INSERT INTO accounts (user_id, handle, created_at)
    VALUES ('u-alice', 'alice', 10), ('u-bob', 'bob', 20)`)
  await db.run(sql`INSERT INTO decks (id, owner_user_id, created_at, slug)
    VALUES ('d-alice', 'u-alice', 30, 'talk'), ('d-bob', 'u-bob', 40, 'talk')`)
  await db.run(sql`INSERT INTO related_links
    (id, deck_id, kind, url, title, position, created_at)
    VALUES ('l-alice', 'd-alice', 'other',
      'https://kanagawapm.connpass.com/event/410635/', 'Kanagawa.pm', 0, 50)`)
  await db.run(sql`INSERT INTO follows
    (follower_user_id, followee_user_id, created_at)
    VALUES ('u-bob', 'u-alice', 60)`)
  await applyMigrations(database, { after: LAST_OF_MAIN })
})
afterAll(() => platform.dispose())

test('D-04, F30-AC6: Given the second scope data, When the third scope migrations are added, Then people, slides, related links and follows stay and every handle is in the shared table', async () => {
  expect(
    await db.all(sql`SELECT user_id, handle FROM accounts ORDER BY user_id`),
  ).toEqual([
    { user_id: 'u-alice', handle: 'alice' },
    { user_id: 'u-bob', handle: 'bob' },
  ])
  expect(
    await db.all(sql`SELECT id, owner_user_id, slug FROM decks ORDER BY id`),
  ).toEqual([
    { id: 'd-alice', owner_user_id: 'u-alice', slug: 'talk' },
    { id: 'd-bob', owner_user_id: 'u-bob', slug: 'talk' },
  ])
  expect(
    await db.all(sql`SELECT id, deck_id, kind, url, title FROM related_links`),
  ).toEqual([
    {
      id: 'l-alice',
      deck_id: 'd-alice',
      kind: 'other',
      url: 'https://kanagawapm.connpass.com/event/410635/',
      title: 'Kanagawa.pm',
    },
  ])
  expect(
    await db.all(sql`SELECT follower_user_id, followee_user_id FROM follows`),
  ).toEqual([{ follower_user_id: 'u-bob', followee_user_id: 'u-alice' }])
  expect(
    await db.all(
      sql`SELECT handle, owner_kind, owner_id FROM handles ORDER BY handle`,
    ),
  ).toEqual([
    { handle: 'alice', owner_kind: 'person', owner_id: 'u-alice' },
    { handle: 'bob', owner_kind: 'person', owner_id: 'u-bob' },
  ])
})
