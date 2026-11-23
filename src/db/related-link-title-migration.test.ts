import { drizzle } from 'drizzle-orm/d1'
import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { seedDeck } from '../publication/test-support'
import { relatedLinks } from './schema'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const orm = drizzle(platform.env.DB)
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

test('F27-AC21: Given links kept before the title became optional, When every migration is applied, Then they are carried over as they were and the order and the index remain', async () => {
  const database = platform.env.DB
  await applyMigrations(database, { until: '0044_terms_accepted.sql' })
  await seedDeck(database, 'talk')
  await orm.insert(relatedLinks).values([
    row({ id: 'a', position: 1, title: 'First', created_at: 5 }),
    row({
      id: 'b',
      position: 2,
      title: 'Second',
      kind: 'other',
      created_at: 6,
    }),
  ])
  await applyMigrations(database, { after: '0044_terms_accepted.sql' })
  const kept = await orm
    .select()
    .from(relatedLinks)
    .orderBy(relatedLinks.position)
  expect(
    kept.map((one) => [one.id, one.title, one.kind, one.created_at]),
  ).toEqual([
    ['a', 'First', 'video', 5],
    ['b', 'Second', 'other', 6],
  ])
  await expect(
    orm.insert(relatedLinks).values(row({ id: 'c', position: 2 })),
  ).rejects.toThrow()
  await orm
    .insert(relatedLinks)
    .values(row({ id: 'd', position: 3, title: null }))
})
