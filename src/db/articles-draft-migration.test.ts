import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { seedDeck } from '../publication/test-support'
import { articles } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
afterAll(() => platform.dispose())

test('F26-AC49: Given articles from before the edit was kept apart, When the migration is applied, Then their text stays, none has an edit, and the revision starts at 0; and the edit is limited to 50,000 characters', async () => {
  const database = platform.env.DB
  const db = drizzle(database)
  await applyMigrations(database, {
    until: '0045_related_link_title_optional.sql',
  })
  await seedDeck(database, 'old')
  await seedDeck(database, 'new')
  await db.run(sql`INSERT INTO articles (deck_id, body, status, created_at, updated_at)
    VALUES ('old', 'kept text', 'published', 1, 2)`)

  await applyMigrations(database, {
    after: '0045_related_link_title_optional.sql',
  })

  expect(await db.select().from(articles)).toMatchObject([
    {
      deck_id: 'old',
      body: 'kept text',
      status: 'published',
      draft_body: null,
      revision: 0,
    },
  ])
  await db.insert(articles).values({
    deck_id: 'new',
    body: 'a',
    draft_body: '😀'.repeat(50_000),
    created_at: 1,
    updated_at: 1,
  })
  await db.run(sql`DELETE FROM articles WHERE deck_id = 'new'`)
  await expect(
    db.insert(articles).values({
      deck_id: 'new',
      body: 'a',
      draft_body: 'x'.repeat(50_001),
      created_at: 1,
      updated_at: 1,
    }),
  ).rejects.toThrow()
  await expect(
    db.run(sql`UPDATE articles SET revision = -1 WHERE deck_id = 'old'`),
  ).rejects.toThrow()
})
