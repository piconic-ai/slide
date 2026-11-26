import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { listCommunityEventIds } from '../communities/store'
import { seedCommunity, seedTalkLink } from '../communities/test-communities'
import { events, relatedLinkEvents } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { seedDeck, seedPerson } from '../publication/test-support'
import { joinAliasedEvent } from './alias-store'
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
    title: 'Hono night',
  })
  const [before] = await allEvents()
  expect(before).toMatchObject({ key: ID, ref: 'evt-nPHM1FY0GGaiJyh' })

  await readFeed()

  expect(await allEvents()).toEqual([
    {
      id: before!.id,
      key: NAME,
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
    title: 'From the id',
  })

  await readFeed()

  expect(await eventOfLink('by-name')).toBe(NAME)
  expect(await eventOfLink('by-id')).toBe(NAME)
  const [named] = (await allEvents()).filter((event) => event.key === NAME)
  // The name's event had none; it takes the one the id's event had.
  expect(named?.name).toBe('From the id')
  expect(await listCommunityEventIds(database, 7)).toContain(named!.id)
  // The id's event is left with no talk, so it shows nowhere (F29-AC12).
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
  await joinAliasedEvent(database, [ID])

  expect(await eventOfLink('by-id')).toBe(NAME)
  const [event] = await allEvents()
  expect(await listCommunityEventIds(database, 7)).toEqual([event!.id])
})

test('F33-AC20: Given a talk linking an id no feed lists, When it is joined, Then it stays an event of its own', async () => {
  const other = 'https://luma.com/event/evt-elsewhere'
  await seedTalkLink(database, { deckId: 'by-id', url: other })
  await readFeed()
  await joinAliasedEvent(database, [other])
  expect(await eventOfLink('by-id')).toBe(other)
  expect(
    await db
      .select()
      .from(relatedLinkEvents)
      .where(eq(relatedLinkEvents.host, 'luma.com')),
  ).toHaveLength(1)
})
