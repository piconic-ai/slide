import { asc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { events } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

const BEFORE = '0060_community_notifications.sql'
const ALIASES = '0061_luma_event_aliases.sql'

const event = (id: number, key: string, ref: string, url: string) => ({
  id,
  key,
  service: 'web' as const,
  ref,
  host: 'luma.com',
  url,
  created_at: 1,
})

beforeAll(async () => {
  await applyMigrations(database, { until: BEFORE })
  await db.insert(events).values([
    // A link to an event's id address, saved before 0061.
    event(
      1,
      'https://luma.com/event/evt-nPHM1FY0GGaiJyh',
      'luma.com/event/evt-nPHM1FY0GGaiJyh',
      'https://luma.com/event/evt-nPHM1FY0GGaiJyh/',
    ),
    // Pages of Luma that are not an event's id address.
    event(
      2,
      'https://luma.com/event',
      'luma.com/event',
      'https://luma.com/event',
    ),
    event(
      3,
      'https://luma.com/event/evt-a/b',
      'luma.com/event/evt-a/b',
      'https://luma.com/event/evt-a/b',
    ),
  ])
  await applyMigrations(database, { after: BEFORE, until: ALIASES })
})
afterAll(() => platform.dispose())

test('F33-AC20: Given an event made from an id address before 0061, When 0061 runs, Then it is an event of Luma whose ref is the id, and other Luma pages stay', async () => {
  expect(
    await db
      .select({
        id: events.id,
        service: events.service,
        ref: events.ref,
        url: events.url,
      })
      .from(events)
      .orderBy(asc(events.id)),
  ).toEqual([
    {
      id: 1,
      service: 'luma',
      ref: 'evt-nPHM1FY0GGaiJyh',
      url: 'https://luma.com/event/evt-nPHM1FY0GGaiJyh',
    },
    {
      id: 2,
      service: 'web',
      ref: 'luma.com/event',
      url: 'https://luma.com/event',
    },
    {
      id: 3,
      service: 'web',
      ref: 'luma.com/event/evt-a/b',
      url: 'https://luma.com/event/evt-a/b',
    },
  ])
})
