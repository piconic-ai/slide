import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import {
  listCommunityEventIds,
  replaceCommunityLinks,
} from '../communities/store'
import { checkCommunityLinks } from '../communities/link-rules'
import { seedCommunity, seedTalkLink } from '../communities/test-communities'
import { applyMigrations } from '../db/test-migrations'
import { seedDeck, seedPerson } from '../publication/test-support'
import { readDueFeeds } from './reader-routes'
import { resumedRecord } from './schedule'
import {
  listStoppedFeeds,
  readFeedRecord,
  requestFeedReads,
  writeFeedRecord,
} from './store'
import { fakeReader, feedOf, resetFeeds } from './test-feeds'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

const feedUrl = (id: string) =>
  `https://api.lu.ma/ics/get?entity=calendar&id=cal-${id}`
const FEED = feedUrl('kpm')
const HOUR_MS = 3_600_000
const once = { limit: 10, maxWaitMs: 7_000 }

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetFeeds(database)
  await seedPerson(database, '722500', 'owner')
  await seedDeck(database, 'talk')
  await seedDeck(database, 'other')
  await seedCommunity(database, { id: 7, handle: 'kpm', links: [FEED] })
})
afterAll(() => platform.dispose())

const eventsOf = (communityId: number) =>
  listCommunityEventIds(database, communityId)

describe('reading a feed into its community', () => {
  test('F33-AC1: Given a community with a Luma calendar and a talk linking an event the feed lists, When the feed is read, Then the talk is in the community', async () => {
    await seedTalkLink(database, {
      deckId: 'talk',
      url: 'https://lu.ma/kpm-one',
    })
    await seedTalkLink(database, {
      deckId: 'other',
      url: 'https://luma.com/elsewhere',
    })
    expect(await eventsOf(7)).toHaveLength(0)
    const { reader, seen } = fakeReader(
      database,
      () =>
        new Response(feedOf('https://lu.ma/kpm-one', 'https://lu.ma/kpm-two')),
    )
    expect(await readDueFeeds(reader, once)).toMatchObject({ read: 1 })
    expect(seen.map(({ request }) => request.url)).toEqual([FEED])
    expect(await eventsOf(7)).toHaveLength(1)
  })

  test('F33-AC1: Given a feed listing an event no talk links yet, When a talk links it later, Then the talk joins the community', async () => {
    const { reader } = fakeReader(
      database,
      () => new Response(feedOf('https://luma.com/later')),
    )
    await readDueFeeds(reader, once)
    expect(await eventsOf(7)).toHaveLength(0)
    await seedTalkLink(database, {
      deckId: 'talk',
      url: 'https://lu.ma/later?ref=x',
    })
    expect(await eventsOf(7)).toHaveLength(1)
  })

  test('F33-AC12: Given a feed with names, times and places, When it is read, Then none of them is kept anywhere', async () => {
    await seedTalkLink(database, {
      deckId: 'talk',
      url: 'https://lu.ma/kpm-one',
    })
    const { reader } = fakeReader(
      database,
      () => new Response(feedOf('https://lu.ma/kpm-one')),
    )
    await readDueFeeds(reader, once)
    const tables = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`,
    )
    for (const { name } of tables) {
      const rows = await db.all(sql.raw(`SELECT * FROM "${name}"`))
      expect(JSON.stringify(rows), name).not.toMatch(
        /Secret meetup|Yokohama|20261201/u,
      )
    }
  })

  test('F33-AC13: Given an event the feed listed, When a later feed no longer lists it, Then it stays in the community', async () => {
    await seedTalkLink(database, { deckId: 'talk', url: 'https://lu.ma/past' })
    let body = feedOf('https://lu.ma/past', 'https://lu.ma/next')
    const { reader, clock } = fakeReader(database, () => new Response(body))
    await readDueFeeds(reader, once)
    expect(await eventsOf(7)).toHaveLength(1)
    body = feedOf('https://lu.ma/next')
    clock.now += 24 * HOUR_MS
    expect(await readDueFeeds(reader, once)).toMatchObject({ read: 1 })
    expect(await eventsOf(7)).toHaveLength(1)
  })
})

describe('the validators', () => {
  test('F33-AC5: Given a full answer with an ETag and a date, When the feed is read again, Then the request is conditional, and a 304 keeps what was read', async () => {
    await seedTalkLink(database, {
      deckId: 'talk',
      url: 'https://lu.ma/kpm-one',
    })
    const { reader, clock, seen } = fakeReader(database, (request) =>
      request.headers.get('If-None-Match') === '"v1"'
        ? new Response(null, { status: 304 })
        : new Response(feedOf('https://lu.ma/kpm-one'), {
            headers: {
              ETag: '"v1"',
              'Last-Modified': 'Tue, 24 Nov 2026 00:00:00 GMT',
            },
          }),
    )
    await readDueFeeds(reader, once)
    clock.now += 24 * HOUR_MS
    expect(await readDueFeeds(reader, once)).toMatchObject({ unchanged: 1 })
    const [first, second] = seen.map(({ request }) => request.headers)
    expect(first?.has('If-None-Match')).toBe(false)
    expect(second?.get('If-None-Match')).toBe('"v1"')
    expect(second?.get('If-Modified-Since')).toBe(
      'Tue, 24 Nov 2026 00:00:00 GMT',
    )
    expect(second?.get('User-Agent')).toBe(
      'slide.community-bot/1.0 (+https://slide.community/help/bot)',
    )
    expect((await readFeedRecord(database, FEED)).validators.etag).toBe('"v1"')
    expect(await eventsOf(7)).toHaveLength(1)
  })
})

describe('the intervals', () => {
  test('F33-AC14: Given a feed read now, When the reader runs again within a day, Then it is not asked again, and a day later it is', async () => {
    const { reader, clock, seen } = fakeReader(
      database,
      () => new Response(feedOf()),
    )
    await readDueFeeds(reader, once)
    clock.now += 23 * HOUR_MS
    await readDueFeeds(reader, once)
    expect(seen).toHaveLength(1)
    clock.now += HOUR_MS
    await readDueFeeds(reader, once)
    expect(seen).toHaveLength(2)
  })

  test('F33-AC3: Given a feed just read, When early reads are asked for again and again within the hour, Then it is asked only once in that hour', async () => {
    const { reader, clock, seen } = fakeReader(
      database,
      () => new Response(feedOf()),
    )
    await readDueFeeds(reader, once)
    for (let minute = 1; minute < 60; minute += 1) {
      clock.now += 60_000
      await requestFeedReads(database, [FEED], Math.floor(clock.now / 1000))
      await readDueFeeds(reader, once)
    }
    expect(seen).toHaveLength(1)
    clock.now += 60_000
    await readDueFeeds(reader, once)
    expect(seen).toHaveLength(2)
  })

  test('F33-AC4: Given 25 feeds due, When two readers read them at once, Then one request is out at a time and no minute holds more than 10', async () => {
    for (let n = 0; n < 24; n += 1)
      await seedCommunity(database, {
        id: 100 + n,
        handle: `c${n}`,
        links: [feedUrl(`n${n}`)],
      })
    let open = 0
    let most = 0
    const { reader, seen } = fakeReader(database, async () => {
      open += 1
      most = Math.max(most, open)
      await new Promise((resolve) => setTimeout(resolve, 5))
      open -= 1
      return new Response(feedOf())
    })
    const all = { limit: 30, maxWaitMs: 7_000 }
    await Promise.all([readDueFeeds(reader, all), readDueFeeds(reader, all)])
    expect(most).toBe(1)
    const starts = seen.map(({ at }) => at)
    expect(starts).toHaveLength(25)
    expect(new Set(seen.map(({ request }) => request.url)).size).toBe(25)
    for (const start of starts)
      expect(
        starts.filter((at) => at >= start && at < start + 60_000).length,
      ).toBeLessThanOrEqual(10)
  })
})

describe('failures', () => {
  test('F33-AC7: Given a 429 with Retry-After of two hours, When early reads are asked for before then, Then the feed is not asked until that time', async () => {
    let status = 429
    const { reader, clock, seen } = fakeReader(database, () =>
      status === 429
        ? new Response(null, {
            status: 429,
            headers: { 'Retry-After': '7200' },
          })
        : new Response(feedOf()),
    )
    await readDueFeeds(reader, once)
    status = 200
    for (const step of [HOUR_MS, HOUR_MS - 1000]) {
      clock.now += step
      await requestFeedReads(database, [FEED], Math.floor(clock.now / 1000))
      await readDueFeeds(reader, once)
    }
    expect(seen).toHaveLength(1)
    clock.now += 1000
    await readDueFeeds(reader, once)
    expect(seen).toHaveLength(2)
  })

  test('F33-AC8: Given failures in a row, When the reader runs every hour, Then the feed is asked after 1, 2, 4 and 8 hours', async () => {
    const { reader, clock, seen } = fakeReader(
      database,
      () => new Response('down', { status: 500 }),
    )
    const start = clock.now
    for (let hour = 0; hour <= 16; hour += 1) {
      clock.now = start + hour * HOUR_MS
      await readDueFeeds(reader, once)
    }
    expect(seen.map(({ at }) => (at - start) / HOUR_MS)).toEqual([
      0, 1, 3, 7, 15,
    ])
  })

  test('F33-AC9: Given five failures in a row, When the reader runs on, Then the feed is no longer asked, is listed as stopped with its reason, and is read again once resumed', async () => {
    const { reader, clock, seen } = fakeReader(database, () =>
      Promise.reject(new TypeError('connection refused')),
    )
    for (let n = 0; n < 5; n += 1) {
      await readDueFeeds(reader, once)
      clock.now += 24 * HOUR_MS
    }
    expect(seen).toHaveLength(5)
    for (let n = 0; n < 5; n += 1) {
      await requestFeedReads(database, [FEED], Math.floor(clock.now / 1000))
      await readDueFeeds(reader, once)
      clock.now += 24 * HOUR_MS
    }
    expect(seen).toHaveLength(5)
    expect(await listStoppedFeeds(database)).toEqual([
      {
        url: FEED,
        community: 'kpm',
        stoppedAt: expect.any(Number),
        reason: 'network',
        failures: 5,
      },
    ])
    const record = await readFeedRecord(database, FEED)
    await writeFeedRecord(
      database,
      resumedRecord(record, Math.floor(clock.now / 1000)),
    )
    await readDueFeeds(reader, once)
    expect(seen).toHaveLength(6)
    expect(await listStoppedFeeds(database)).toEqual([])
  })

  test('F33-AC11: Given an answer that is not a calendar, When the feed is read, Then it counts as a failure and nothing is added', async () => {
    await seedTalkLink(database, {
      deckId: 'talk',
      url: 'https://lu.ma/kpm-one',
    })
    const { reader } = fakeReader(
      database,
      () => new Response('<html>https://lu.ma/kpm-one</html>'),
    )
    expect(await readDueFeeds(reader, once)).toMatchObject({ failed: 1 })
    expect(await eventsOf(7)).toHaveLength(0)
    expect((await readFeedRecord(database, FEED)).state).toEqual({
      kind: 'active',
      lastFailure: 'not_calendar',
    })
  })

  test('Given a calendar that moves to another community, When an early read is asked for within the hour, Then the feed is not asked again', async () => {
    const { reader, clock, seen } = fakeReader(
      database,
      () => new Response(feedOf()),
    )
    await readDueFeeds(reader, once)
    clock.now += 30 * 60_000
    await seedCommunity(database, {
      id: 8,
      handle: 'kpm2',
      links: ['https://kpm2.example/'],
    })
    await db.run(
      sql`UPDATE community_links SET community_id = 8 WHERE url = ${FEED}`,
    )
    await requestFeedReads(database, [FEED], Math.floor(clock.now / 1000))
    await readDueFeeds(reader, once)
    expect(seen).toHaveLength(1)
  })
})

describe('reads cut off and links added again', () => {
  test('F33-AC9: Given a read cut off before its outcome is written, When the next run comes at once, Then it counted as a failure and the other feeds are read first', async () => {
    await seedCommunity(database, {
      id: 8,
      handle: 'second',
      links: [feedUrl('second')],
    })
    // A database that fails as the first feed's keys are written, as when
    // the Worker is cut off in the middle of a read.
    let broken = true
    const failing = new Proxy(database, {
      get(target, name) {
        if (name === 'prepare')
          return (query: string) => {
            if (broken && /insert into "community_feed_events"/iu.test(query)) {
              broken = false
              throw new Error('cut off')
            }
            return target.prepare(query)
          }
        const value = Reflect.get(target, name) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const { reader, seen } = fakeReader(
      failing,
      () => new Response(feedOf('https://lu.ma/kpm-one')),
    )
    await expect(readDueFeeds(reader, once)).rejects.toThrow('cut off')
    expect(seen.map(({ request }) => request.url)).toEqual([FEED])
    const record = await readFeedRecord(database, FEED)
    expect(record.failures).toBe(1)
    expect(record.state).toEqual({ kind: 'active', lastFailure: 'interrupted' })
    await readDueFeeds(reader, once)
    expect(seen.map(({ request }) => request.url)).toEqual([
      FEED,
      feedUrl('second'),
    ])
  })

  test('F33-AC1: Given a calendar read with an ETag, When its link is taken away and added again, Then the next read asks without validators and its talks join again', async () => {
    await seedTalkLink(database, {
      deckId: 'talk',
      url: 'https://lu.ma/kpm-one',
    })
    const { reader, clock, seen } = fakeReader(database, (request) =>
      request.headers.get('If-None-Match') === '"v1"'
        ? new Response(null, { status: 304 })
        : new Response(feedOf('https://lu.ma/kpm-one'), {
            headers: { ETag: '"v1"' },
          }),
    )
    await readDueFeeds(reader, once)
    expect(await eventsOf(7)).toHaveLength(1)
    const links = (urls: string[]) => {
      const check = checkCommunityLinks(urls)
      if (!check.ok) throw new Error('bad links')
      return check.links
    }
    await replaceCommunityLinks(database, {
      communityId: 7,
      links: links(['https://kpm.example/']),
      now: 2000,
    })
    await replaceCommunityLinks(database, {
      communityId: 7,
      links: links(['https://kpm.example/', FEED]),
      now: 3000,
    })
    expect(await eventsOf(7)).toHaveLength(0)
    clock.now += 24 * HOUR_MS
    expect(await readDueFeeds(reader, once)).toMatchObject({ read: 1 })
    expect(seen[1]?.request.headers.has('If-None-Match')).toBe(false)
    expect(await eventsOf(7)).toHaveLength(1)
  })
})
