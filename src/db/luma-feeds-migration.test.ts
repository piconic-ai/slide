import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { communities, communityLinks, lumaFeedGate, lumaFeeds } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

const BEFORE = '0052_communities.sql'
const FEEDS = '0053_luma_feeds.sql'
const FEED = 'https://api.lu.ma/ics/get?entity=calendar&id=cal-abc'

const existingState = async () => ({
  schema: await db.all(sql`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE tbl_name NOT IN ('luma_feeds', 'luma_feed_gate') ORDER BY type, name`),
  communities: await db.select().from(communities),
  links: await db.select().from(communityLinks),
})
let before: Awaited<ReturnType<typeof existingState>>

beforeAll(async () => {
  await applyMigrations(database, { until: BEFORE })
  await db
    .insert(communities)
    .values({ id: 7, name: 'Luma group', color: 'navy', created_at: 1 })
  await db.insert(communityLinks).values({
    community_id: 7,
    url: FEED,
    kind: 'luma',
    host: null,
    created_at: 1,
  })
  before = await existingState()
  await applyMigrations(database, { after: BEFORE, until: FEEDS })
})
afterAll(() => platform.dispose())

test('Given communities and a Luma link before 0053, When the feeds are migrated, Then the existing schema and rows are unchanged', async () => {
  expect(await existingState()).toEqual(before)
})

test('F33-AC4: Given migration 0053, When the gate is read, Then there is one, open', async () => {
  expect(await db.select().from(lumaFeedGate)).toEqual([
    { id: 1, busy_until: 0, next_start_at: 0 },
  ])
  await expect(
    db.insert(lumaFeedGate).values({ id: 2, busy_until: 0, next_start_at: 0 }),
  ).rejects.toThrow()
})

test('F33-AC12: Given migration 0053, When the record of a feed is inspected, Then it has no column for what the feed lists', async () => {
  const columns = (
    await db.all<{ name: string }>(sql`PRAGMA table_info('luma_feeds')`)
  ).map((column) => column.name)
  expect(columns).toEqual([
    'url',
    'read_at',
    'not_before',
    'due_at',
    'retry_until',
    'etag',
    'last_modified',
    'failures',
    'last_failure',
    'stopped_at',
  ])
})

test('F33-AC9: Given migration 0053, When a stopped feed without a reason or an unknown reason is written, Then the database refuses it', async () => {
  await expect(
    db.insert(lumaFeeds).values({ url: FEED, stopped_at: 5 }),
  ).rejects.toThrow()
  await expect(
    db.run(
      sql`INSERT INTO luma_feeds (url, last_failure) VALUES (${FEED}, 'bogus')`,
    ),
  ).rejects.toThrow()
  await db
    .insert(lumaFeeds)
    .values({ url: FEED, stopped_at: 5, last_failure: 'timeout', failures: 5 })
  expect(await db.select().from(lumaFeeds)).toHaveLength(1)
})
