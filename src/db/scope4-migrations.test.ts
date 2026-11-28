import { readdirSync, readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from './test-migrations'

// The fourth scope's migrations (0062 and later) only add (D-09): they land on
// the third scope's last state (0058) and main's 0059 to 0061 (the Luma feed
// host, the community notifications and the Luma event aliases, which main
// reviewed on its own), whose data they keep. They are numbered without a gap,
// so the last one (the scope of the agent connections) is in the list. The
// migrations after it are applied here too, and must keep the same data.

const LAST_OF_SCOPE3 = '0058_community_follows.sql'
// The last migration of main; the fourth scope's follow it.
const FROM_MAIN = '0061_luma_event_aliases.sql'

// The last migration of the fourth scope; later ones are not its own.
const LAST_OF_SCOPE4 = '0070_mcp_scope.sql'

const scope4 = readdirSync('migrations')
  .filter(
    (name) =>
      name.endsWith('.sql') && name > FROM_MAIN && name <= LAST_OF_SCOPE4,
  )
  .sort()

// What would take away or rebuild a table or a column, comments left out.
const takesAway = (name: string) =>
  [
    ...readFileSync(`migrations/${name}`, 'utf8')
      .replace(/--.*$/gm, '')
      .matchAll(
        /\b(DROP\s+\w+|RENAME\b|ALTER\s+TABLE\s+\w+\s+(?!ADD\s+COLUMN\b)\w+|DELETE\s+FROM|TRUNCATE|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE)/gi,
      ),
  ].map(([statement]) => statement!.replace(/\s+/g, ' '))

test('D-09: Given the fourth scope migrations, When their numbers are read, Then they are 0062 to 0070 with no gap', () => {
  expect(scope4.map((name) => name.slice(0, 4))).toEqual(
    Array.from({ length: 9 }, (_, index) =>
      String(62 + index).padStart(4, '0'),
    ),
  )
})

test('D-09: Given the fourth scope migrations, When their statements are read, Then none drops, renames, deletes or rebuilds a table or a column', () => {
  expect(
    Object.fromEntries(scope4.map((name) => [name, takesAway(name)])),
  ).toEqual(Object.fromEntries(scope4.map((name) => [name, []])))
})

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

beforeAll(async () => {
  await applyMigrations(database, { until: LAST_OF_SCOPE3 })
  // The third scope's last state: people, their slides, a community and a
  // follow of each kind.
  await db.run(sql`INSERT INTO accounts (user_id, handle, created_at)
    VALUES ('u-alice', 'alice', 10), ('u-bob', 'bob', 20)`)
  await db.run(sql`INSERT INTO decks (id, owner_user_id, created_at, slug)
    VALUES ('d-alice', 'u-alice', 30, 'talk')`)
  await db.run(sql`INSERT INTO follows
    (follower_user_id, followee_user_id, created_at)
    VALUES ('u-bob', 'u-alice', 60)`)
  await db.run(sql`INSERT INTO communities (id, name, color, created_at)
    VALUES (7, 'Tokyo meetup', 'green', 40)`)
  await db.run(sql`INSERT INTO community_admins (community_id, user_id, added_at)
    VALUES (7, 'u-alice', 41)`)
  await db.run(sql`INSERT INTO community_follows (user_id, community_id, created_at)
    VALUES ('u-bob', 7, 70)`)
  // Main's 0059 to 0061, the fourth scope's 0062 to 0070 and what follows.
  await applyMigrations(database, { after: LAST_OF_SCOPE3 })
})
afterAll(() => platform.dispose())

test('D-09: Given the third scope data, When the 0059 to 0061 of main and the fourth scope migrations are added, Then people, slides, communities and follows stay', async () => {
  expect(
    await db.all(sql`SELECT user_id, handle FROM accounts ORDER BY user_id`),
  ).toEqual([
    { user_id: 'u-alice', handle: 'alice' },
    { user_id: 'u-bob', handle: 'bob' },
  ])
  expect(await db.all(sql`SELECT id, slug FROM decks`)).toEqual([
    { id: 'd-alice', slug: 'talk' },
  ])
  expect(
    await db.all(sql`SELECT follower_user_id, followee_user_id FROM follows`),
  ).toEqual([{ follower_user_id: 'u-bob', followee_user_id: 'u-alice' }])
  expect(await db.all(sql`SELECT id, name, color FROM communities`)).toEqual([
    { id: 7, name: 'Tokyo meetup', color: 'green' },
  ])
  expect(
    await db.all(sql`SELECT community_id, user_id FROM community_admins`),
  ).toEqual([{ community_id: 7, user_id: 'u-alice' }])
  expect(
    await db.all(sql`SELECT user_id, community_id FROM community_follows`),
  ).toEqual([{ user_id: 'u-bob', community_id: 7 }])
  // The last one, which was renumbered, is applied as well.
  const columns = await db.all<{ name: string }>(
    sql`SELECT name FROM pragma_table_info('mcp_grants')`,
  )
  expect(columns.map((column) => column.name)).toContain('scope')
})
