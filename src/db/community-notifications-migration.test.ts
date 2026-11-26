import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { applyMigrations } from './test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = drizzle(platform.env.DB)
afterAll(() => platform.dispose())

beforeAll(() => applyMigrations(platform.env.DB))

const insert = (
  id: string,
  kind: string,
  deck: string | null,
  community: number | null,
  recipient = '11',
) =>
  db.run(sql`INSERT INTO notifications
    (id, recipient_user_id, kind, actor_user_id, deck_id, community_id, created_at)
    VALUES (${id}, ${recipient}, ${kind}, '22', ${deck}, ${community}, 40)`)

test('Given a community_published notice, When it is inserted with a deck and a community, Then it is stored; without either, Then it is refused', async () => {
  await db.run(sql`INSERT INTO communities (id, name, color, created_at)
    VALUES (9, 'C', 'red', 1)`)
  await insert('ok', 'community_published', 'd9', 9)
  await expect(
    insert('no-community', 'community_published', 'd8', null),
  ).rejects.toThrow()
  await expect(
    insert('no-deck', 'community_published', null, 9),
  ).rejects.toThrow()
  await expect(
    insert('unknown-community', 'community_published', 'd7', 404),
  ).rejects.toThrow()
})

test.each(['cited', 'followee_published', 'followed'])(
  'Given the old kind %s, When it names a community, Then the shape constraint refuses it',
  async (kind) => {
    await expect(
      db.run(sql`INSERT INTO notifications
        (id, recipient_user_id, kind, actor_user_id, deck_id, target_deck_id, community_id, created_at)
        VALUES ('x', '55', ${kind},
          '22', ${kind === 'followed' ? null : 'd1'}, ${kind === 'cited' ? 'd2' : null}, 9, 10)`),
    ).rejects.toThrow()
  },
)

test('Given a followee_published notice of a slide, When a community_published notice of the same slide is inserted for the same person, Then it is refused; for another person or slide it is not', async () => {
  await insert('p1', 'followee_published', 'dd', null, '66')
  await expect(
    insert('p2', 'community_published', 'dd', 9, '66'),
  ).rejects.toThrow()
  await insert('p3', 'community_published', 'dd', 9, '77')
  await insert('p4', 'community_published', 'de', 9, '66')
})

test('Given the community column, When a community is looked up by it, Then the partial index serves the lookup', async () => {
  const plan = await db.all<{ detail: string }>(
    sql`EXPLAIN QUERY PLAN SELECT id FROM notifications WHERE community_id = 9`,
  )
  expect(plan.map((row) => row.detail).join(' ')).toContain(
    'notifications_community',
  )
})
