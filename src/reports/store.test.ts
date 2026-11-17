import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { drizzle } from 'drizzle-orm/d1'
import { reports } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { deckIdSchema } from '../decks/binding'
import { seedDeck } from '../publication/test-support'
import { saveReport } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const deckId = deckIdSchema.parse('talk')
const otherDeckId = deckIdSchema.parse('another')
const firstReport = {
  deckId,
  deploymentId: 'version-one',
  sharePath: '/@owner/talk',
  reason: 'nuisance',
  note: 'first note',
  reporterUserId: 'reader-one',
  now: 100,
} satisfies Parameters<typeof saveReport>[1]

beforeAll(async () => {
  await applyMigrations(database)
  await seedDeck(database, deckId)
  await seedDeck(database, otherDeckId)
})
beforeEach(() => db.delete(reports))
afterAll(() => platform.dispose())

test('F17-AC16: Given a reader reporting a deck, When the report is saved, Then its UUID, viewing context, reason, note and timestamps are stored', async () => {
  await saveReport(database, firstReport)
  expect(await db.select().from(reports)).toEqual([
    {
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      deck_id: deckId,
      deployment_id: 'version-one',
      share_path: '/@owner/talk',
      reason: 'nuisance',
      note: 'first note',
      reporter_user_id: 'reader-one',
      created_at: 100,
      updated_at: 100,
    },
  ])
})

test('F17-AC25: Given an existing report, When the same reader reports the same deck again, Then one row keeps its ID and created time with the second report details', async () => {
  await saveReport(database, firstReport)
  const original = await db.select().from(reports).get()
  expect(original).toBeDefined()

  await saveReport(database, {
    ...firstReport,
    deploymentId: 'version-two',
    sharePath: '/@owner/renamed?p=2',
    reason: 'rights',
    note: 'second note',
    now: 200,
  })

  expect(await db.select().from(reports)).toEqual([
    {
      ...original,
      reason: 'rights',
      note: 'second note',
      deployment_id: 'version-two',
      share_path: '/@owner/renamed?p=2',
      updated_at: 200,
    },
  ])
})

test('F17-AC25: Given an existing report, When another reader reports the same deck, Then a second independent report is stored', async () => {
  await saveReport(database, firstReport)
  await saveReport(database, {
    ...firstReport,
    reporterUserId: 'reader-two',
    note: 'another reader',
    now: 200,
  })
  const rows = await db.select().from(reports).orderBy(reports.reporter_user_id)
  expect(rows).toEqual([
    expect.objectContaining({
      deck_id: deckId,
      reporter_user_id: 'reader-one',
      note: 'first note',
      created_at: 100,
    }),
    expect.objectContaining({
      deck_id: deckId,
      reporter_user_id: 'reader-two',
      note: 'another reader',
      created_at: 200,
    }),
  ])
  expect(new Set(rows.map((row) => row.id)).size).toBe(2)
})

test('F17-AC25: Given an existing report, When the same reader reports another deck, Then a separate report is stored for that deck', async () => {
  await saveReport(database, firstReport)
  await saveReport(database, {
    ...firstReport,
    deckId: otherDeckId,
    deploymentId: 'another-version',
    sharePath: '/@owner/another',
    note: '',
    now: 200,
  })
  const rows = await db.select().from(reports).orderBy(reports.deck_id)
  expect(rows).toEqual([
    expect.objectContaining({
      deck_id: otherDeckId,
      reporter_user_id: 'reader-one',
      deployment_id: 'another-version',
      share_path: '/@owner/another',
      note: '',
      created_at: 200,
    }),
    expect.objectContaining({
      deck_id: deckId,
      reporter_user_id: 'reader-one',
      note: 'first note',
      created_at: 100,
    }),
  ])
  expect(new Set(rows.map((row) => row.id)).size).toBe(2)
})
