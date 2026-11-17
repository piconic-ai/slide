import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { accounts, decks, reports } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { deckIdSchema } from '../decks/binding'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  seedPublic,
} from '../publication/test-support'
import { listReportedDecks, saveReport } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await db.insert(accounts).values({
    user_id: OWNER_ID,
    handle: 'owner',
    created_at: 1,
  })
})
afterAll(() => platform.dispose())

const report = (
  deck: string,
  now: number,
  reporterUserId = 'private-reader-one',
) =>
  saveReport(database, {
    deckId: deckIdSchema.parse(deck),
    deploymentId: 'version-one',
    sharePath: `/@owner/${deck}`,
    reason: 'nuisance',
    note: '',
    reporterUserId,
    now,
  })

test('F17-AC17: Given two reported decks and two readers on one, When reports are listed, Then decks and reports are newest first with people counted and no identities', async () => {
  await seedPublic(database, 'a-older', 1, null)
  await seedPublic(database, 'z-newer', 1, null)
  await report('z-newer', 100)
  await report('a-older', 200)
  await report('z-newer', 250, 'private-reader-two')
  await saveReport(database, {
    deckId: deckIdSchema.parse('z-newer'),
    deploymentId: 'version-two',
    sharePath: '/@owner/z-newer/3',
    reason: 'rights',
    note: 'copied material',
    reporterUserId: 'private-reader-one',
    now: 300,
  })

  const listed = await listReportedDecks(database)

  expect(listed).toEqual([
    {
      handle: 'owner',
      slug: 'z-newer',
      reporters: 2,
      lastReportedAt: 300,
      reports: [
        {
          reason: 'rights',
          note: 'copied material',
          sharePath: '/@owner/z-newer/3',
          updatedAt: 300,
        },
        {
          reason: 'nuisance',
          note: '',
          sharePath: '/@owner/z-newer',
          updatedAt: 250,
        },
      ],
    },
    {
      handle: 'owner',
      slug: 'a-older',
      reporters: 1,
      lastReportedAt: 200,
      reports: [
        {
          reason: 'nuisance',
          note: '',
          sharePath: '/@owner/a-older',
          updatedAt: 200,
        },
      ],
    },
  ])
  const serialized = JSON.stringify(listed)
  for (const secret of [
    'private-reader-one',
    'private-reader-two',
    'reporter_user_id',
    'reporterUserId',
    '"id":',
    ...(await db.select({ id: reports.id }).from(reports)).map((row) => row.id),
  ])
    expect(serialized).not.toContain(secret)
})

test('F17-AC17: Given an unreported deck and a deleted deck with a report, When reports are listed, Then neither deck appears', async () => {
  await seedDeck(database, 'unreported')
  await seedDeck(database, 'deleted')
  await report('deleted', 100)
  await db.update(decks).set({ deleted_at: 200 }).where(eq(decks.id, 'deleted'))

  expect(await listReportedDecks(database)).toEqual([])
})

test('F17-AC17: Given hidden, paused and private decks with reports, When reports are listed, Then all remain visible to the operator', async () => {
  await seedPublic(database, 'hidden', 1, null)
  const deployment = await seedPublic(database, 'paused', 1, null)
  await seedDeck(database, 'private')
  await db
    .update(decks)
    .set({
      hidden_at: 10,
      hidden_reason: 'reason',
      hidden_by: 'op@example.com',
    })
    .where(eq(decks.id, 'hidden'))
  await db
    .update(decks)
    .set({
      public_deployment_id: null,
      paused_at: 10,
      resume_deployment_id: deployment,
    })
    .where(eq(decks.id, 'paused'))
  for (const deck of ['private', 'paused', 'hidden']) await report(deck, 100)

  expect((await listReportedDecks(database)).map((deck) => deck.slug)).toEqual([
    'hidden',
    'paused',
    'private',
  ])
})

test('F17-AC17: Given 51 reported decks and multiple reports on the newest, When reports are listed, Then only the newest 50 decks appear with all their reports', async () => {
  for (let index = 0; index < 51; index++) {
    const deck = `deck-${index}`
    await seedDeck(database, deck)
    await report(deck, 100 + index)
  }
  await report('deck-50', 200, 'private-reader-two')

  const listed = await listReportedDecks(database)

  expect(listed).toHaveLength(50)
  expect(listed.map((deck) => deck.slug)).toEqual(
    Array.from({ length: 50 }, (_, index) => `deck-${50 - index}`),
  )
  expect(listed[0]).toMatchObject({ reporters: 2 })
  expect(listed[0]?.reports).toHaveLength(2)
})
