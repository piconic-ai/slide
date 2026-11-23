import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { resetTables, seedDeck } from '../publication/test-support'
import { relatedLinks } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
})
afterAll(() => platform.dispose())

const row = (over: Partial<typeof relatedLinks.$inferInsert> = {}) => ({
  id: crypto.randomUUID(),
  deck_id: 'talk',
  kind: 'video' as const,
  url: 'https://example.com/',
  title: 'T',
  position: 1,
  created_at: 1,
  ...over,
})

test('F27-AC1: Given the table, When a row has a kind outside the three, Then the table refuses it', async () => {
  await expect(
    orm.insert(relatedLinks).values(row({ kind: 'audio' as 'video' })),
  ).rejects.toThrow()
})

test('F27-AC7: Given the table, When a title is empty or has 101 characters, Then the table refuses it, and 100 is kept', async () => {
  await expect(
    orm.insert(relatedLinks).values(row({ title: '' })),
  ).rejects.toThrow()
  await expect(
    orm.insert(relatedLinks).values(row({ title: 'あ'.repeat(101) })),
  ).rejects.toThrow()
  await orm.insert(relatedLinks).values(row({ title: 'あ'.repeat(100) }))
})

test('F27-AC2: Given a deck with a link at a position, When another link takes the same position, Then the table refuses it', async () => {
  await orm.insert(relatedLinks).values(row())
  await expect(orm.insert(relatedLinks).values(row())).rejects.toThrow()
})

test('F27-AC13: Given a link, When it names a deck that does not exist, Then the table refuses it', async () => {
  await expect(
    orm.insert(relatedLinks).values(row({ deck_id: 'nothing' })),
  ).rejects.toThrow()
})

test('F27-AC24: Given the table, When a link has no title, Then the table keeps it, and an empty or 101-character title is still refused', async () => {
  await orm.insert(relatedLinks).values(row({ title: null }))
  expect((await orm.select().from(relatedLinks).all())[0]?.title).toBeNull()
  await expect(
    orm.insert(relatedLinks).values(row({ position: 2, title: '' })),
  ).rejects.toThrow()
  await expect(
    orm
      .insert(relatedLinks)
      .values(row({ position: 3, title: 'a'.repeat(101) })),
  ).rejects.toThrow()
})
