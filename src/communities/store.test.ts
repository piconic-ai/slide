import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import {
  communities,
  communityAdmins,
  communityFeedEvents,
  communityLinks,
  events,
  handles,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { seedDeck, seedPerson } from '../publication/test-support'
import type { Handle } from '../share/handle'
import { checkCommunityLinks, type CommunityLink } from './link-rules'
import {
  addFeedEvents,
  createCommunity,
  listCommunityEventIds,
  listCommunityLinks,
  listFeedLinks,
  replaceCommunityLinks,
} from './store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from './test-communities'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetCommunities(database)
  await seedPerson(database, '722500', 'owner')
  await seedDeck(database, 'talk')
  await seedDeck(database, 'other')
})
afterAll(() => platform.dispose())

const linksOf = (...inputs: string[]): readonly CommunityLink[] => {
  const check = checkCommunityLinks(inputs)
  if (!check.ok) throw new Error('bad links')
  return check.links
}
const KANAGAWA_EVENT = 'https://kanagawapm.connpass.com/event/410635/'
const eventId = async (key: string) =>
  (await db.select().from(events).where(eq(events.key, key)).get())?.id

describe('making a community', () => {
  test('F30-AC9: Given a free handle and links, When a community is made, Then its handle, row, links and its maker as admin are written', async () => {
    const result = await createCommunity(database, {
      id: 42,
      handle: 'kanagawapm' as Handle,
      name: 'Kanagawa.pm',
      color: 'navy',
      links: linksOf(
        'https://kanagawapm.connpass.com/',
        'https://kanagawa.pm/',
      ),
      creator: '722500',
      now: 1000,
    })
    expect(result).toEqual({ kind: 'created' })
    expect(
      await db.select().from(handles).where(eq(handles.handle, 'kanagawapm')),
    ).toEqual([
      {
        handle: 'kanagawapm',
        owner_kind: 'community',
        owner_id: '42',
        created_at: 1000,
      },
    ])
    expect(await db.select().from(communities)).toMatchObject([
      {
        id: 42,
        name: 'Kanagawa.pm',
        color: 'navy',
        description: '',
        sites: '[]',
      },
    ])
    expect(await db.select().from(communityAdmins)).toEqual([
      { community_id: 42, user_id: '722500', added_at: 1000 },
    ])
    expect(
      (await listCommunityLinks(database, 42)).map((link) => link.url),
    ).toEqual(['https://kanagawapm.connpass.com/', 'https://kanagawa.pm/'])
  })

  test('F30-AC1: Given a handle a person holds, When a community takes it, Then nothing is written and the reason is taken', async () => {
    await db.insert(handles).values({
      handle: 'owner',
      owner_kind: 'person',
      owner_id: '722500',
      created_at: 1,
    })
    const result = await createCommunity(database, {
      id: 7,
      handle: 'owner' as Handle,
      name: 'Owner',
      color: 'red',
      links: linksOf('https://owner.connpass.com/'),
      creator: '722500',
      now: 1000,
    })
    expect(result).toEqual({ kind: 'handle', reason: 'taken' })
    expect(await db.select().from(communities)).toEqual([])
    expect(await db.select().from(communityLinks)).toEqual([])
    expect(await db.select().from(communityAdmins)).toEqual([])
  })

  test('F30-AC13: Given a link another community holds, When a community is made with it, Then nothing is written and the holder is named', async () => {
    await seedCommunity(database, {
      id: 1,
      handle: 'hono',
      links: ['https://hono.connpass.com/'],
    })
    const result = await createCommunity(database, {
      id: 2,
      handle: 'kanagawapm' as Handle,
      name: 'Kanagawa.pm',
      color: 'red',
      links: linksOf(
        'https://kanagawapm.connpass.com/',
        'https://hono.connpass.com/',
      ),
      creator: '722500',
      now: 1000,
    })
    expect(result).toEqual({
      kind: 'links',
      conflicts: new Map([['https://hono.connpass.com/', 'hono']]),
    })
    expect(
      await db.select().from(handles).where(eq(handles.handle, 'kanagawapm')),
    ).toEqual([])
    expect(
      await db.select().from(communities).where(eq(communities.id, 2)),
    ).toEqual([])
  })

  test('F30-AC13: Given two communities made at once with the same link, When both are sent, Then exactly one holds the link', async () => {
    const make = (id: number, handle: string) =>
      createCommunity(database, {
        id,
        handle: handle as Handle,
        name: handle,
        color: 'red',
        links: linksOf('https://kanagawapm.connpass.com/'),
        creator: '722500',
        now: 1000,
      })
    const results = await Promise.all([make(1, 'one'), make(2, 'two')])
    expect(results.filter((result) => result.kind === 'created')).toHaveLength(
      1,
    )
    expect(await db.select().from(communityLinks)).toHaveLength(1)
    expect(await db.select().from(communities)).toHaveLength(1)
  })
})

describe('matching events', () => {
  test('F30-AC14: Given an event linked before the community was made, When the community is made with its group, Then the event is in it', async () => {
    await seedTalkLink(database, { deckId: 'talk', url: KANAGAWA_EVENT })
    await seedCommunity(database, {
      id: 1,
      handle: 'kanagawapm',
      links: ['https://kanagawapm.connpass.com/'],
    })
    expect(await listCommunityEventIds(database, 1)).toEqual([
      await eventId('https://connpass.com/event/410635'),
    ])
  })

  test('F30-AC14: Given a community, When an event of its own site and of its Doorkeeper group are linked after it, Then both are in it and an event of another host is not', async () => {
    await seedCommunity(database, {
      id: 1,
      handle: 'kanagawapm',
      links: ['https://kanagawa.pm/', 'https://kanagawa.doorkeeper.jp/'],
    })
    await seedTalkLink(database, {
      deckId: 'talk',
      url: 'https://kanagawa.pm/2026/04',
    })
    await seedTalkLink(database, {
      deckId: 'talk',
      url: 'https://kanagawa.doorkeeper.jp/events/12',
    })
    await seedTalkLink(database, {
      deckId: 'other',
      url: 'https://other.doorkeeper.jp/events/12',
    })
    const ids = await listCommunityEventIds(database, 1)
    expect(ids).toEqual(
      [
        await eventId('https://kanagawa.pm/2026/04'),
        await eventId('https://kanagawa.doorkeeper.jp/events/12'),
      ].sort((a, b) => (a ?? 0) - (b ?? 0)),
    )
  })

  test('F30-AC14: Given one connpass event linked with two groups, When each group has a community, Then the event is in both', async () => {
    await seedTalkLink(database, { deckId: 'talk', url: KANAGAWA_EVENT })
    await seedTalkLink(database, {
      deckId: 'other',
      url: 'https://yokohama.connpass.com/event/410635/',
    })
    await seedCommunity(database, {
      id: 1,
      handle: 'kanagawapm',
      links: ['https://kanagawapm.connpass.com/'],
    })
    await seedCommunity(database, {
      id: 2,
      handle: 'yokohama',
      links: ['https://yokohama.connpass.com/'],
    })
    const id = await eventId('https://connpass.com/event/410635')
    expect(await listCommunityEventIds(database, 1)).toEqual([id])
    expect(await listCommunityEventIds(database, 2)).toEqual([id])
  })

  test('F30-AC15: Given a community with two links, When one is taken away, Then the events it brought leave and the others stay', async () => {
    await seedTalkLink(database, { deckId: 'talk', url: KANAGAWA_EVENT })
    await seedTalkLink(database, {
      deckId: 'other',
      url: 'https://kanagawa.pm/2026/04',
    })
    await seedCommunity(database, {
      id: 1,
      handle: 'kanagawapm',
      links: ['https://kanagawapm.connpass.com/', 'https://kanagawa.pm/'],
    })
    expect(await listCommunityEventIds(database, 1)).toHaveLength(2)
    expect(
      await replaceCommunityLinks(database, {
        communityId: 1,
        links: linksOf('https://kanagawa.pm/'),
        now: 2000,
      }),
    ).toEqual({ kind: 'saved' })
    expect(await listCommunityEventIds(database, 1)).toEqual([
      await eventId('https://kanagawa.pm/2026/04'),
    ])
    expect(
      (await listCommunityLinks(database, 1)).map((link) => link.url),
    ).toEqual(['https://kanagawa.pm/'])
  })

  test('F30-AC15: Given a link taken away, When it is added back, Then its events come back', async () => {
    await seedTalkLink(database, { deckId: 'talk', url: KANAGAWA_EVENT })
    await seedCommunity(database, {
      id: 1,
      handle: 'kanagawapm',
      links: ['https://kanagawapm.connpass.com/', 'https://kanagawa.pm/'],
    })
    await replaceCommunityLinks(database, {
      communityId: 1,
      links: linksOf('https://kanagawa.pm/'),
      now: 2,
    })
    expect(await listCommunityEventIds(database, 1)).toEqual([])
    await replaceCommunityLinks(database, {
      communityId: 1,
      links: linksOf(
        'https://kanagawa.pm/',
        'https://kanagawapm.connpass.com/',
      ),
      now: 3,
    })
    expect(await listCommunityEventIds(database, 1)).toHaveLength(1)
  })

  test('F30-AC16: Given an event linked without a group, When communities of every group exist, Then it is in none', async () => {
    await seedTalkLink(database, {
      deckId: 'talk',
      url: 'https://connpass.com/event/410635/',
    })
    await seedCommunity(database, {
      id: 1,
      handle: 'kanagawapm',
      links: ['https://kanagawapm.connpass.com/'],
    })
    expect(await listCommunityEventIds(database, 1)).toEqual([])
  })

  test('F30-AC13: Given a link another community holds, When links are replaced with it, Then nothing changes and the holder is named', async () => {
    await seedCommunity(database, {
      id: 1,
      handle: 'hono',
      links: ['https://hono.connpass.com/'],
    })
    await seedCommunity(database, {
      id: 2,
      handle: 'kanagawapm',
      links: ['https://kanagawapm.connpass.com/'],
    })
    expect(
      await replaceCommunityLinks(database, {
        communityId: 2,
        links: linksOf('https://hono.connpass.com/'),
        now: 2,
      }),
    ).toEqual({
      kind: 'links',
      conflicts: new Map([['https://hono.connpass.com/', 'hono']]),
    })
    expect(
      (await listCommunityLinks(database, 2)).map((link) => link.url),
    ).toEqual(['https://kanagawapm.connpass.com/'])
  })
})

describe('the feeds of Luma calendars', () => {
  const LUMA = 'https://api.lu.ma/ics/get?entity=calendar&id=cal-abc'

  test('Given a community with a Luma calendar, When its feed lists an event a slide links, Then the event is in the community, and a key it lists before any slide waits for one', async () => {
    await seedCommunity(database, { id: 1, handle: 'lumapm', links: [LUMA] })
    const [feed] = await listFeedLinks(database)
    expect(feed).toMatchObject({ communityId: 1, url: LUMA })
    await seedTalkLink(database, {
      deckId: 'talk',
      url: 'https://lu.ma/abc123',
    })
    await addFeedEvents(database, {
      linkId: feed!.linkId,
      keys: [
        'https://luma.com/abc123',
        'https://luma.com/later',
        'https://luma.com/abc123',
      ],
      now: 5,
    })
    expect(await listCommunityEventIds(database, 1)).toEqual([
      await eventId('https://luma.com/abc123'),
    ])
    await seedTalkLink(database, {
      deckId: 'other',
      url: 'https://luma.com/later',
    })
    expect(await listCommunityEventIds(database, 1)).toHaveLength(2)
  })

  test('Given a Luma calendar taken away, When the community is read, Then the events its feed brought leave with their keys', async () => {
    await seedCommunity(database, {
      id: 1,
      handle: 'lumapm',
      links: [LUMA, 'https://kanagawa.pm/'],
    })
    const [feed] = await listFeedLinks(database)
    await seedTalkLink(database, {
      deckId: 'talk',
      url: 'https://lu.ma/abc123',
    })
    await addFeedEvents(database, {
      linkId: feed!.linkId,
      keys: ['https://luma.com/abc123'],
      now: 5,
    })
    await replaceCommunityLinks(database, {
      communityId: 1,
      links: linksOf('https://kanagawa.pm/'),
      now: 6,
    })
    expect(await listCommunityEventIds(database, 1)).toEqual([])
    expect(await db.select().from(communityFeedEvents)).toEqual([])
  })

  test('Given a link that is not a Luma calendar, When feed events are added to it, Then nothing is written', async () => {
    await seedCommunity(database, {
      id: 1,
      handle: 'kanagawapm',
      links: ['https://kanagawa.pm/'],
    })
    const [link] = await listCommunityLinks(database, 1)
    await addFeedEvents(database, {
      linkId: link!.id,
      keys: ['https://luma.com/x'],
      now: 5,
    })
    await addFeedEvents(database, {
      linkId: 999,
      keys: ['https://luma.com/x'],
      now: 5,
    })
    expect(await db.select().from(communityFeedEvents)).toEqual([])
  })

  test('Given a feed listing more events than one statement binds, When they are added, Then every key is kept', async () => {
    await seedCommunity(database, { id: 1, handle: 'lumapm', links: [LUMA] })
    const [feed] = await listFeedLinks(database)
    const keys = Array.from({ length: 75 }, (_, i) => `https://luma.com/e${i}`)
    await addFeedEvents(database, { linkId: feed!.linkId, keys, now: 5 })
    expect(await db.select().from(communityFeedEvents)).toHaveLength(75)
  })
})
