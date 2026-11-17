import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { decks, reports } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { deckIdSchema } from '../decks/binding'
import { markDeckDeleted, purgeDeletedDecks } from '../decks/deletion'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  testEnv,
} from '../publication/test-support'
import { saveReport } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = testEnv(platform.env)
const GRACE = 3600

const report = (deck: string, reporter: string) =>
  saveReport(database, {
    deckId: deckIdSchema.parse(deck),
    deploymentId: 'deployment',
    sharePath: `/@owner/${deck}`,
    reason: 'nuisance',
    note: '',
    reporterUserId: reporter,
    now: 10,
  })
const reportedDecks = async () =>
  (await db.select({ deck: reports.deck_id }).from(reports))
    .map((row) => row.deck)
    .sort()

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await db.delete(reports)
  await resetTables(database)
  await seedDeck(database, 'talk')
  await seedDeck(database, 'another')
  await report('talk', 'reader-1')
  await report('talk', 'reader-2')
  await report('another', 'reader-1')
})
afterAll(() => platform.dispose())

test('F17-AC26: Given reports on two decks, When the owner deletes one deck, Then its reports are gone and the other deck keeps its report', async () => {
  await markDeckDeleted(database, {
    deckId: 'talk',
    ownerUserId: OWNER_ID,
    now: 1000,
  })

  expect(await reportedDecks()).toEqual(['another'])
})

test("F17-AC26: Given another owner's deck with reports, When someone else tries to delete it, Then its reports stay", async () => {
  await markDeckDeleted(database, {
    deckId: 'talk',
    ownerUserId: 'someone-else',
    now: 1000,
  })

  expect(await reportedDecks()).toEqual(['another', 'talk', 'talk'])
})

test('F17-AC26: Given a report that reached a deck after it was deleted, When the purge removes the deck, Then the report goes with it and the purge does not fail', async () => {
  await markDeckDeleted(database, {
    deckId: 'talk',
    ownerUserId: OWNER_ID,
    now: 1000,
  })
  await report('talk', 'late-reader')

  const summary = await purgeDeletedDecks(env, 1000 + GRACE, GRACE)

  expect(summary.decks).toBe(1)
  expect(await reportedDecks()).toEqual(['another'])
  expect(
    (await db.select({ id: decks.id }).from(decks)).map((r) => r.id),
  ).toEqual(['another'])
})
