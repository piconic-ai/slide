import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { resetTables, seedDeck } from '../publication/test-support'
import { articleCitations, articles } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
afterAll(() => platform.dispose())
beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
})

test('F26-AC9: Given a deck with an article, When a second article is inserted for the deck, Then the table refuses it, so a deck has one article', async () => {
  await seedDeck(database, 'talk')
  await db
    .insert(articles)
    .values({ deck_id: 'talk', body: 'a', created_at: 1, updated_at: 1 })
  await expect(
    db
      .insert(articles)
      .values({ deck_id: 'talk', body: 'b', created_at: 2, updated_at: 2 }),
  ).rejects.toThrow()
  expect((await db.select().from(articles)).map((row) => row.body)).toEqual([
    'a',
  ])
})

test('F26-AC16: Given the articles table, When a body of exactly 50,000 characters and one of 50,001 are inserted, Then the first is kept and the second refused', async () => {
  await seedDeck(database, 'a')
  await seedDeck(database, 'b')
  await db.insert(articles).values({
    deck_id: 'a',
    body: '😀'.repeat(50_000),
    created_at: 1,
    updated_at: 1,
  })
  await expect(
    db.insert(articles).values({
      deck_id: 'b',
      body: 'x'.repeat(50_001),
      created_at: 1,
      updated_at: 1,
    }),
  ).rejects.toThrow()
})

test('F26-AC4: Given the articles table, When a status other than draft and published is written, Then it is refused, and a new article is a draft', async () => {
  await seedDeck(database, 'talk')
  await expect(
    db.run(
      // A status the types do not allow, written as SQL.
      sql`INSERT INTO articles (deck_id, body, status, created_at, updated_at)
        VALUES ('talk', 'a', 'deleted', 1, 1)`,
    ),
  ).rejects.toThrow()
  await db
    .insert(articles)
    .values({ deck_id: 'talk', body: 'a', created_at: 1, updated_at: 1 })
  expect(
    (await db.select().from(articles).where(eq(articles.deck_id, 'talk')))[0]
      ?.status,
  ).toBe('draft')
})

test('F24-AC19: Given the article citations table, When the same link and an out-of-range page are inserted, Then the repeat and the page are refused', async () => {
  await seedDeck(database, 'talk')
  const row = {
    deck_id: 'talk',
    target_handle: 'ann',
    target_slug: 'deck',
    target_page: 3,
  }
  await db.insert(articleCitations).values(row)
  await expect(db.insert(articleCitations).values(row)).rejects.toThrow()
  await expect(
    db.insert(articleCitations).values({ ...row, target_page: 10_000 }),
  ).rejects.toThrow()
})
