import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, deployments, reports } from './schema'
import { applyMigrations } from './test-migrations'
import { seedDeck, seedDeployment } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
let previousDecks: (typeof decks.$inferSelect)[] = []
let previousDeployments: (typeof deployments.$inferSelect)[] = []

beforeAll(async () => {
  await applyMigrations(database, { until: '0023_drop_deck_slug_trigger.sql' })
  await seedDeck(database, 'before')
  await seedDeck(database, 'another')
  await seedDeployment(database, 'before')
  await seedDeployment(database, 'another', 'uploading')
  previousDecks = await db.select().from(decks).orderBy(decks.id)
  previousDeployments = await db
    .select()
    .from(deployments)
    .orderBy(deployments.id)
  await applyMigrations(database, {
    after: '0023_drop_deck_slug_trigger.sql',
    until: '0024_reports.sql',
  })
})
afterAll(() => platform.dispose())

test('Given decks and deployments from before 0024, When reports are migrated, Then every existing row is unchanged', async () => {
  expect(await db.select().from(decks).orderBy(decks.id)).toEqual(previousDecks)
  expect(await db.select().from(deployments).orderBy(deployments.id)).toEqual(
    previousDeployments,
  )
})

test('Given migration 0024, When its schema is inspected, Then the reports table and unique deck-reporter index exist', async () => {
  expect(
    await db.all(sql`SELECT type, name FROM sqlite_master
    WHERE name IN ('reports', 'reports_deck_reporter') ORDER BY name`),
  ).toEqual([
    { type: 'table', name: 'reports' },
    { type: 'index', name: 'reports_deck_reporter' },
  ])
  expect(await db.all(sql`PRAGMA index_list('reports')`)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'reports_deck_reporter', unique: 1 }),
    ]),
  )
  expect(await db.all(sql`PRAGMA index_info('reports_deck_reporter')`)).toEqual(
    [
      expect.objectContaining({ seqno: 0, name: 'deck_id' }),
      expect.objectContaining({ seqno: 1, name: 'reporter_user_id' }),
    ],
  )
  expect(await db.select().from(reports)).toEqual([])
})

test('Given migration 0024, When reports are inserted, Then empty notes and absent reporters are allowed but invalid reasons and unknown decks are rejected', async () => {
  await db.insert(reports).values({
    id: 'valid',
    deck_id: 'before',
    deployment_id: 'version',
    share_path: '/@owner/before',
    reason: 'nuisance',
    note: '',
    reporter_user_id: null,
    created_at: 1,
    updated_at: 1,
  })
  expect(await db.select().from(reports).get()).toMatchObject({
    id: 'valid',
    note: '',
    reporter_user_id: null,
  })
  await expect(
    db.run(sql`INSERT INTO reports
    (id, deck_id, deployment_id, share_path, reason, note, created_at, updated_at)
    VALUES ('invalid', 'before', 'version', '/@owner/before', 'invalid', '', 1, 1)`),
  ).rejects.toThrow()
  await expect(
    db.insert(reports).values({
      id: 'missing-deck',
      deck_id: 'missing',
      deployment_id: 'version',
      share_path: '/@owner/missing',
      reason: 'rights',
      note: '',
      created_at: 1,
      updated_at: 1,
    }),
  ).rejects.toThrow()
})
