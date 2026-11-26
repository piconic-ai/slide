import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { listCommunityEventIds } from '../communities/store'
import { seedCommunity, seedTalkLink } from '../communities/test-communities'
import { communityFeedEvents, communityLinks, lumaFeeds } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { eventRefOf } from '../events/event-url'
import {
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import {
  readCalendarsForEventSoon,
  readNewCalendarsSoon,
} from './reader-routes'
import { claimedRecord, newFeedRecord } from './schedule'
import { claimFeed } from './store'
import { resetFeeds } from './test-feeds'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
/** A local start with the local feed on. */
const local = {
  ...env,
  PUBLIC_ORIGIN: 'http://localhost:8770',
  LUMA_FEED_MOCK: 'on',
} as unknown as Env

const feedUrl = (id: string) =>
  `https://api.lu.ma/ics/get?entity=calendar&id=cal-${id}`
const nowSeconds = () => Math.floor(Date.now() / 1000)

let owner = ''
let asked: unknown[] = []
const fetchSpy = vi.spyOn(globalThis, 'fetch')
beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetFeeds(database)
  owner = await signIn(env)
  await seedPublic(database, 'talk', 100, 'Talk')
  asked = []
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    if (typeof line === 'string' && line.includes('luma_mock_request'))
      asked.push(JSON.parse(line))
  })
})
afterEach(() => {
  vi.mocked(console.log).mockRestore()
  // No request of these tests ever leaves the Worker.
  expect(fetchSpy).not.toHaveBeenCalled()
})
afterAll(() => platform.dispose())

/** Collects what a request hands to waitUntil, to wait for it. */
function context() {
  const work: Promise<unknown>[] = []
  return {
    work,
    ctx: {
      waitUntil: (promise: Promise<unknown>) => work.push(promise),
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext,
    waitUntil: (promise: Promise<unknown>) => {
      work.push(promise)
    },
  }
}

const post = (
  path: string,
  fields: ReadonlyArray<readonly [string, string]>,
  ctx?: ExecutionContext,
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Cookie: owner,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields.map(([k, v]) => [k, v])).toString(),
    }),
    env,
    ctx,
  )
const recordOf = (url: string) =>
  db.select().from(lumaFeeds).where(eq(lumaFeeds.url, url)).get()

describe('a calendar just added', () => {
  test('F33-AC2: Given a person making a community with a Luma calendar, When it is made, Then its feed is due at once', async () => {
    const { ctx } = context()
    const response = await post(
      '/communities/new',
      [
        ['handle', 'lumagroup'],
        ['name', 'Luma group'],
        ['link', feedUrl('one')],
        ['link', 'https://lumagroup.example/'],
      ],
      ctx,
    )
    expect(response.status).toBe(303)
    const record = await recordOf(feedUrl('one'))
    expect(record?.due_at).toBeLessThanOrEqual(nowSeconds())
    expect(record?.read_at).toBeNull()
  })

  test('F33-AC2: Given a community whose calendar was read, When an admin adds another, Then only the new one is due', async () => {
    await seedCommunity(database, {
      id: 7,
      handle: 'kpm',
      links: [feedUrl('old')],
    })
    await db
      .insert(lumaFeeds)
      .values({ url: feedUrl('old'), read_at: 1, not_before: 1, due_at: 9e9 })
    const { ctx } = context()
    const response = await post(
      '/communities/7/edit',
      [
        ['name', 'kpm'],
        ['description', ''],
        ['color', 'red'],
        ['link', feedUrl('old')],
        ['link', feedUrl('new')],
      ],
      ctx,
    )
    expect(response.status).toBe(303)
    expect((await recordOf(feedUrl('old')))?.due_at).toBe(9e9)
    expect((await recordOf(feedUrl('new')))?.due_at).toBeLessThanOrEqual(
      nowSeconds(),
    )
  })

  test('F33-AC2: Given a calendar not read within the hour, When it is added on a local start, Then it is read after the response and its talks join', async () => {
    await seedTalkLink(database, {
      deckId: 'talk',
      url: 'https://lu.ma/slide-mock-one',
    })
    const since = nowSeconds()
    await seedCommunity(database, {
      id: 7,
      handle: 'kpm',
      links: [feedUrl('kpm')],
      now: since,
    })
    const { work, waitUntil } = context()
    await readNewCalendarsSoon(local, waitUntil, 7, since)
    await Promise.all(work)
    expect(asked).toEqual([
      expect.objectContaining({
        id: 'cal-kpm',
        userAgent:
          'slide.community-bot/1.0 (+https://slide.community/help/bot)',
      }),
    ])
    expect(await listCommunityEventIds(database, 7)).toHaveLength(1)
  })

  test('F33-AC2: Given a calendar read within the hour, When it is added again, Then it is not read now', async () => {
    const since = nowSeconds()
    await seedCommunity(database, {
      id: 7,
      handle: 'kpm',
      links: [feedUrl('kpm')],
      now: since,
    })
    expect(
      await claimFeed(
        database,
        claimedRecord(newFeedRecord(feedUrl('kpm')), since - 600),
        since - 600,
      ),
    ).toBe(true)
    const { work, waitUntil } = context()
    await readNewCalendarsSoon(local, waitUntil, 7, since)
    await Promise.all(work)
    expect(asked).toEqual([])
  })
})

describe('a Luma event no calendar lists', () => {
  test('F33-AC3: Given two calendars, When a talk links a Luma event neither lists, Then both feeds are due', async () => {
    await seedCommunity(database, { id: 7, handle: 'a', links: [feedUrl('a')] })
    await seedCommunity(database, { id: 8, handle: 'b', links: [feedUrl('b')] })
    await db.insert(lumaFeeds).values([
      { url: feedUrl('a'), due_at: 9e9 },
      { url: feedUrl('b'), due_at: 9e9 },
    ])
    const { ctx } = context()
    await post(
      '/my/slides/talk/links',
      [
        ['kind', 'event'],
        ['url', 'https://lu.ma/unknown-event'],
        ['title', ''],
      ],
      ctx,
    )
    for (const id of ['a', 'b'])
      expect((await recordOf(feedUrl(id)))?.due_at).toBeLessThanOrEqual(
        nowSeconds(),
      )
  })

  test('F33-AC3: Given a calendar already listing the event, When a talk links it, Then no feed is due early', async () => {
    await seedCommunity(database, { id: 7, handle: 'a', links: [feedUrl('a')] })
    await db.insert(lumaFeeds).values({ url: feedUrl('a'), due_at: 9e9 })
    const [link] = await db.select().from(communityLinks)
    await db.insert(communityFeedEvents).values({
      link_id: link?.id ?? 0,
      event_key: 'https://luma.com/known',
      added_at: 1,
    })
    const { ctx } = context()
    await post(
      '/my/slides/talk/links',
      [
        ['kind', 'event'],
        ['url', 'https://luma.com/known'],
        ['title', ''],
      ],
      ctx,
    )
    expect((await recordOf(feedUrl('a')))?.due_at).toBe(9e9)
  })

  test('F33-AC3: Given a link changed to the kind "event", When it is saved, Then the feeds are due', async () => {
    await seedCommunity(database, { id: 7, handle: 'a', links: [feedUrl('a')] })
    await db.insert(lumaFeeds).values({ url: feedUrl('a'), due_at: 9e9 })
    await post('/my/slides/talk/links', [
      ['kind', 'other'],
      ['url', 'https://lu.ma/kind-later'],
      ['title', ''],
    ])
    expect((await recordOf(feedUrl('a')))?.due_at).toBe(9e9)
    const [row] = await db.all<{ id: string }>(
      sql`SELECT id FROM related_links WHERE url = 'https://lu.ma/kind-later'`,
    )
    await post('/my/slides/talk/links/kinds', [[`kind-${row?.id}`, 'event']])
    expect((await recordOf(feedUrl('a')))?.due_at).toBeLessThanOrEqual(
      nowSeconds(),
    )
  })

  test('F33-AC3: Given a stopped calendar, When a talk links an unknown event on a local start, Then only the others are read', async () => {
    await seedCommunity(database, { id: 7, handle: 'a', links: [feedUrl('a')] })
    await seedCommunity(database, { id: 8, handle: 'b', links: [feedUrl('b')] })
    await db.insert(lumaFeeds).values({
      url: feedUrl('a'),
      failures: 5,
      last_failure: 'timeout',
      stopped_at: 1,
    })
    const ref = eventRefOf('https://lu.ma/slide-mock-two')
    if (!ref) throw new Error('no ref')
    const { work, waitUntil } = context()
    await readCalendarsForEventSoon(local, waitUntil, ref)
    await Promise.all(work)
    expect(asked).toEqual([expect.objectContaining({ id: 'cal-b' })])
  })

  test('Given an event of another service, When it is saved, Then no feed is due', async () => {
    await seedCommunity(database, { id: 7, handle: 'a', links: [feedUrl('a')] })
    const ref = eventRefOf('https://kanagawapm.connpass.com/event/1/')
    if (!ref) throw new Error('no ref')
    await readCalendarsForEventSoon(local, null, ref)
    expect(await recordOf(feedUrl('a'))).toBeUndefined()
  })
})
