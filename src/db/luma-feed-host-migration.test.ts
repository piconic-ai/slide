import { asc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { communities, communityLinks, lumaFeeds } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

const BEFORE = '0058_community_follows.sql'
const HOST = '0059_luma_feed_host.sql'
const OLD = (id: string) => `https://api.lu.ma/ics/get?entity=calendar&id=${id}`
const NEW = (id: string) =>
  `https://api.luma.com/ics/get?entity=calendar&id=${id}`

beforeAll(async () => {
  await applyMigrations(database, { until: BEFORE })
  await db.insert(communities).values(
    [7, 8, 9].map((id) => ({
      id,
      name: `group ${id}`,
      color: 'navy' as const,
      created_at: 1,
    })),
  )
  await db.insert(communityLinks).values([
    // Saved under the older host.
    {
      community_id: 7,
      url: OLD('cal-moved'),
      kind: 'luma',
      host: null,
      created_at: 1,
    },
    // The same calendar, saved under both hosts by two communities.
    {
      community_id: 8,
      url: NEW('cal-both'),
      kind: 'luma',
      host: null,
      created_at: 1,
    },
    {
      community_id: 9,
      url: OLD('cal-both'),
      kind: 'luma',
      host: null,
      created_at: 1,
    },
    // Not Luma at all.
    {
      community_id: 7,
      url: 'https://kanagawapm.connpass.com/',
      kind: 'connpass',
      host: 'kanagawapm.connpass.com',
      created_at: 1,
    },
  ])
  await db.insert(lumaFeeds).values([
    {
      url: OLD('cal-moved'),
      read_at: 10,
      due_at: 20,
      etag: '"a"',
      failures: 2,
      last_failure: 'network',
    },
    { url: OLD('cal-both'), read_at: 11, due_at: 21 },
    { url: NEW('cal-both'), read_at: 12, due_at: 22 },
  ])
  await applyMigrations(database, { after: BEFORE, until: HOST })
})
afterAll(() => platform.dispose())

test('F33-AC10: Given a Luma link saved under api.lu.ma, When 0059 runs, Then it names the same calendar under api.luma.com and keeps its community', async () => {
  const links = await db
    .select({ community: communityLinks.community_id, url: communityLinks.url })
    .from(communityLinks)
    .orderBy(asc(communityLinks.id))
  expect(links).toEqual([
    { community: 7, url: NEW('cal-moved') },
    { community: 8, url: NEW('cal-both') },
    // Moving it would repeat community 8's address, which must be unique.
    { community: 9, url: OLD('cal-both') },
    { community: 7, url: 'https://kanagawapm.connpass.com/' },
  ])
})

test('F33-AC8: Given the record of a feed under api.lu.ma, When 0059 runs, Then it follows the address, and one whose new address has a record stays behind', async () => {
  const feeds = await db
    .select({
      url: lumaFeeds.url,
      read_at: lumaFeeds.read_at,
      etag: lumaFeeds.etag,
      failures: lumaFeeds.failures,
    })
    .from(lumaFeeds)
    .orderBy(asc(lumaFeeds.url))
  expect(feeds).toEqual([
    { url: OLD('cal-both'), read_at: 11, etag: null, failures: 0 },
    { url: NEW('cal-both'), read_at: 12, etag: null, failures: 0 },
    { url: NEW('cal-moved'), read_at: 10, etag: '"a"', failures: 2 },
  ])
})
