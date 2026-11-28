import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { readCommunityTalks } from '../communities/page-store'
import { listCommunityEventIds } from '../communities/store'
import { seedCommunity, seedTalkLink } from '../communities/test-communities'
import { accounts, events, relatedLinkEvents } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { seedDeck, seedPerson, seedPublic } from '../publication/test-support'
import { joinAliasedEvents } from './alias-store'
import { readDueFeeds } from './reader-routes'
import { fakeReader, resetFeeds } from './test-feeds'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

const FEED = 'https://api.luma.com/ics/get?entity=calendar&id=cal-kpm'
const NAME = 'https://luma.com/e03n9o8s'
const ID = 'https://luma.com/event/evt-nPHM1FY0GGaiJyh'
const once = { limit: 10, maxWaitMs: 7_000 }

// A calendar with one event as Luma writes it (2026-11-26).
const LUMA_FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:evt-nPHM1FY0GGaiJyh@events.lu.ma',
  'SUMMARY:Test event',
  'DESCRIPTION:Get up-to-date information at: https://luma.com/e03n9o8s\\n\\nHosted by kobaken',
  'LOCATION:https://luma.com/event/evt-nPHM1FY0GGaiJyh',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n')

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetFeeds(database)
  await seedPerson(database, '722500', 'owner')
  for (const deck of ['by-name', 'by-id']) await seedDeck(database, deck)
  await seedCommunity(database, { id: 7, handle: 'kpm', links: [FEED] })
})
afterAll(() => platform.dispose())

const readFeed = () =>
  readDueFeeds(fakeReader(database, () => new Response(LUMA_FEED)).reader, once)

const allEvents = () =>
  db
    .select({
      id: events.id,
      key: events.key,
      service: events.service,
      ref: events.ref,
      url: events.url,
      name: events.name,
    })
    .from(events)
    .orderBy(asc(events.id))

const eventOfLink = async (deckId: string) =>
  (
    await database
      .prepare(
        `SELECT e.key FROM related_link_events rle
        JOIN related_links rl ON rl.id = rle.link_id
        JOIN events e ON e.id = rle.event_id WHERE rl.deck_id = ?1`,
      )
      .bind(deckId)
      .first<{ key: string }>()
  )?.key

test('F33-AC20: Given a talk linking the event by its id alone, When the feed pairs the id with the name, Then its event takes the name, keeps its number and is in the community', async () => {
  await seedTalkLink(database, {
    deckId: 'by-id',
    url: ID,
  })
  // A name kept from when events were named (F45-AC11).
  await db.update(events).set({ name: 'Hono night' })
  const [before] = await allEvents()
  expect(before).toMatchObject({ key: ID, ref: 'evt-nPHM1FY0GGaiJyh' })

  await readFeed()

  expect(await allEvents()).toEqual([
    {
      id: before!.id,
      key: NAME,
      service: 'luma',
      ref: 'e03n9o8s',
      url: NAME,
      name: 'Hono night',
    },
  ])
  expect(await listCommunityEventIds(database, 7)).toEqual([before!.id])
})

test('F33-AC20: Given talks linking the event by its name and by its id, When the feed pairs them, Then both talks are in the event of the name', async () => {
  await seedTalkLink(database, { deckId: 'by-name', url: NAME })
  await seedTalkLink(database, {
    deckId: 'by-id',
    url: ID,
  })
  // A name kept from when events were named (F45-AC11).
  await db.update(events).set({ name: 'From the id' }).where(eq(events.key, ID))

  await readFeed()

  expect(await eventOfLink('by-name')).toBe(NAME)
  expect(await eventOfLink('by-id')).toBe(NAME)
  const [named] = (await allEvents()).filter((event) => event.key === NAME)
  // The name's event had none; it takes the one the id's event had.
  expect(named?.name).toBe('From the id')
  expect(await listCommunityEventIds(database, 7)).toEqual([named!.id])
  // The id's event is left with no talk and out of the community, so it
  // shows nowhere (F45-AC40, F45-AC14).
  const [left] = (await allEvents()).filter((event) => event.key === ID)
  expect(
    await db
      .select()
      .from(relatedLinkEvents)
      .where(eq(relatedLinkEvents.event_id, left!.id)),
  ).toEqual([])
})

test('F33-AC20: Given a feed read before, When a talk then links the event by its id and the save joins it, Then the talk is in the event of the name', async () => {
  await readFeed()
  await seedTalkLink(database, { deckId: 'by-id', url: ID })
  expect(await eventOfLink('by-id')).toBe(ID)

  // What saving a link of a Luma event does next (readCalendarsForEventSoon).
  await joinAliasedEvents(database)

  expect(await eventOfLink('by-id')).toBe(NAME)
  const [event] = await allEvents()
  expect(await listCommunityEventIds(database, 7)).toEqual([event!.id])
})

test('F33-AC20: Given a talk linking an id no feed lists, When it is joined, Then it stays an event of its own', async () => {
  const other = 'https://luma.com/event/evt-elsewhere'
  await seedTalkLink(database, { deckId: 'by-id', url: other })
  await readFeed()
  await joinAliasedEvents(database)
  expect(await eventOfLink('by-id')).toBe(other)
  expect(
    await db
      .select()
      .from(relatedLinkEvents)
      .where(eq(relatedLinkEvents.host, 'luma.com')),
  ).toHaveLength(1)
})

test('F33-AC20: Given a community whose feed lists only the id and another whose feed pairs it with the name, When both are read, Then the talk stays in both communities', async () => {
  const OTHER = 'https://api.luma.com/ics/get?entity=calendar&id=cal-other'
  await seedCommunity(database, { id: 8, handle: 'other', links: [OTHER] })
  await seedTalkLink(database, { deckId: 'by-id', url: ID })
  const idOnly = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    `LOCATION:${ID}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
  await readDueFeeds(
    fakeReader(
      database,
      (request) => new Response(request.url === OTHER ? LUMA_FEED : idOnly),
    ).reader,
    once,
  )
  const [event] = await allEvents()
  expect(event?.key).toBe(NAME)
  expect(await listCommunityEventIds(database, 7)).toEqual([event!.id])
  expect(await listCommunityEventIds(database, 8)).toEqual([event!.id])
})

test('F33-AC20: Given a feed that paired the id before, When another community’s feed lists only the id, Then the talk is in that community too', async () => {
  const OTHER = 'https://api.luma.com/ics/get?entity=calendar&id=cal-other'
  await seedTalkLink(database, { deckId: 'by-id', url: ID })
  await readFeed()
  await seedCommunity(database, { id: 8, handle: 'other', links: [OTHER] })
  const idOnly = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    `LOCATION:${ID}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
  await readDueFeeds(
    fakeReader(database, () => new Response(idOnly), 1_900_000_000_000).reader,
    once,
  )
  const [event] = await allEvents()
  expect(await listCommunityEventIds(database, 8)).toEqual([event!.id])
})

test('F33-AC20: F30-AC65: Given public slides that carry the Luma event by its name and by its id under the kinds other and article, When the feed pairs them, Then both are among the slides of the community, as a Luma address of the kind other is an event (F45-AC37)', async () => {
  await db
    .insert(accounts)
    .values({ user_id: '722500', handle: 'owner', created_at: 1 })
    .onConflictDoNothing()
  await seedPublic(database, 'other-kind', 100, 'Other kind')
  await seedPublic(database, 'article-kind', 101, 'Article kind')
  await seedTalkLink(database, {
    deckId: 'other-kind',
    url: NAME,
    kind: 'other',
  })
  await seedTalkLink(database, {
    deckId: 'article-kind',
    url: ID,
    kind: 'article',
  })

  await readFeed()

  const { slides } = await readCommunityTalks(database, 7, null)
  expect(slides.map((talk) => talk.slug).sort()).toEqual([
    'article-kind',
    'other-kind',
  ])
})
