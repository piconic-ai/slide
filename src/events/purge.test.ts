import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import {
  communities,
  decks,
  events,
  eventTalks,
  purgedPrefixes,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { markDeckDeleted, purgeDeletedDecks } from '../decks/deletion'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = testEnv(platform.env)

const GRACE = 3600
const deletedAt = 1000

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await orm.delete(purgedPrefixes)
  await seedDeck(db, 'talk')
  await seedDeck(db, 'other')
  await orm.insert(communities).values({
    id: 'kyotojs',
    name: 'Kyoto.js',
    url: 'https://kyotojs.example/',
  })
  await orm.insert(events).values({
    id: 'tokyotojs-03',
    community_id: 'kyotojs',
    name: 'ToKyoto.js #03',
    url: 'https://kyotojs.example/event/402321/',
    hashtag: null,
    held_on: '2026-09-03',
  })
})
afterAll(() => platform.dispose())

test('Given a deleted deck that was a talk of an event, When the purge runs, Then the deck goes and the event keeps its other talks', async () => {
  await orm.insert(eventTalks).values([
    { event_id: 'tokyotojs-03', position: 1, deck_id: 'talk' },
    { event_id: 'tokyotojs-03', position: 2, deck_id: 'other' },
    {
      event_id: 'tokyotojs-03',
      position: 3,
      title: 'Elsewhere',
      url: 'https://slides.example/elsewhere',
    },
  ])
  await markDeckDeleted(db, {
    deckId: 'talk',
    ownerUserId: OWNER_ID,
    now: deletedAt,
  })

  const purged = await purgeDeletedDecks(env, deletedAt + GRACE, GRACE)

  expect(purged).toMatchObject({ decks: 1, failed: 0 })
  expect(await orm.$count(decks, eq(decks.id, 'talk'))).toBe(0)
  expect(
    (
      await orm
        .select({ position: eventTalks.position })
        .from(eventTalks)
        .orderBy(asc(eventTalks.position))
    ).map((row) => row.position),
  ).toEqual([2, 3])
  expect(await orm.$count(events)).toBe(1)
})

test('Given a deck already a talk of an event, When it is listed there again, Then the second listing is refused', async () => {
  await orm
    .insert(eventTalks)
    .values({ event_id: 'tokyotojs-03', position: 1, deck_id: 'talk' })

  await expect(
    orm
      .insert(eventTalks)
      .values({ event_id: 'tokyotojs-03', position: 2, deck_id: 'talk' }),
  ).rejects.toThrow()
})
