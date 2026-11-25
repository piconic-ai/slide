import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { seedDeck, seedDeployment } from '../publication/test-support'
import { citations, decks, deployments } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
afterAll(() => platform.dispose())

const TRIAL_TABLES = ['reaction_posts', 'communities', 'events', 'event_talks']
// The third scope makes new tables under some of the trial's names (events,
// communities), so the trial's are looked for up to the end of the second.
const LAST_OF_SCOPE2 = '0048_gravatar_checked_at.sql'

const namesLike = async (database: D1Database, pattern: string) =>
  (
    await drizzle(database).all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE name LIKE ${pattern} OR tbl_name LIKE ${pattern} ORDER BY name`,
    )
  ).map((row) => row.name)

test('F24-AC16: Given a database with posts, an event with talks and a citation from the trial, When every migration of the second scope is applied, Then the tables of posts and events are gone with their index, and the decks, versions and citations are kept', async () => {
  const database = platform.env.DB
  const db = drizzle(database)
  await applyMigrations(database, { until: '0028_follows.sql' })
  await seedDeck(database, 'talk')
  const deployment = await seedDeployment(database, 'talk')
  await db.insert(citations).values({
    deployment_id: deployment,
    target_handle: 'reader',
    target_slug: 'reply',
    target_page: 6,
  })
  await db.run(sql`INSERT INTO reaction_posts
    (id, deck_id, page, service, post_key, source, created_at)
    VALUES ('p1', 'talk', 0, 'x', '1830000000000000000', 'pasted', 1)`)
  await db.run(sql`INSERT INTO communities (id, name, url)
    VALUES ('c1', 'Kyoto.js', 'https://kyotojs.example/')`)
  await db.run(sql`INSERT INTO events (id, community_id, name, url, hashtag, held_on)
    VALUES ('e1', 'c1', 'ToKyoto.js #03', 'https://kyotojs.example/e/', NULL, '2026-09-03')`)
  await db.run(sql`INSERT INTO event_talks (event_id, position, deck_id)
    VALUES ('e1', 1, 'talk')`)
  const before = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
  )
  expect(before.map((row) => row.name)).toEqual(
    expect.arrayContaining(TRIAL_TABLES),
  )

  await applyMigrations(database, {
    after: '0028_follows.sql',
    until: LAST_OF_SCOPE2,
  })

  const tables = (
    await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
    )
  ).map((row) => row.name)
  for (const gone of TRIAL_TABLES) expect(tables).not.toContain(gone)
  expect(await namesLike(database, 'event%')).toEqual([])
  expect(await namesLike(database, 'reaction%')).toEqual([])
  expect(await namesLike(database, 'communit%')).toEqual([])
  expect(await db.select().from(citations)).toEqual([
    {
      deployment_id: deployment,
      target_handle: 'reader',
      target_slug: 'reply',
      target_page: 6,
    },
  ])
  expect(await db.select({ id: decks.id }).from(decks)).toEqual([
    { id: 'talk' },
  ])
  expect(await db.select({ id: deployments.id }).from(deployments)).toEqual([
    { id: deployment },
  ])
  // No row is left pointing at a table that went.
  expect(await db.all(sql`PRAGMA foreign_key_check`)).toEqual([])
})

test('F24-AC16: Given an empty database, When every migration of the second scope is applied from the first, Then no table of posts or events exists and citations can be kept', async () => {
  const fresh = await getPlatformProxy<Env>({ persist: false })
  try {
    const database = fresh.env.DB
    await applyMigrations(database, { until: LAST_OF_SCOPE2 })
    const tables = (
      await drizzle(database).all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
      )
    ).map((row) => row.name)

    for (const gone of TRIAL_TABLES) expect(tables).not.toContain(gone)
    expect(tables).toContain('citations')
  } finally {
    await fresh.dispose()
  }
  // A second database is started and every migration applied to it.
}, 30000)
