import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { accounts, notifications } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { resetTables, testEnv } from '../publication/test-support'
import { READ_RETENTION_SECONDS, UNREAD_RETENTION_SECONDS } from './limits'
import { countUnread, deleteExpiredNotifications } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const NOW = 200_000_000
const ALICE = '101'
const BOB = '202'

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await db.insert(accounts).values([
    { user_id: ALICE, handle: 'alice', created_at: 1 },
    { user_id: BOB, handle: 'bob', created_at: 1 },
  ])
})
afterAll(() => platform.dispose())

let actors = 0
// Each notice has its own actor, as a followed notice is once per person.
async function put(
  id: string,
  recipient: string,
  createdAt: number,
  readAt: number | null,
) {
  const actor = `actor-${(actors += 1)}`
  await db
    .insert(accounts)
    .values({ user_id: actor, handle: `actor${actors}`, created_at: 1 })
  await db.insert(notifications).values({
    id,
    kind: 'followed',
    recipient_user_id: recipient,
    actor_user_id: actor,
    created_at: createdAt,
    read_at: readAt,
  })
}
const ids = async () =>
  (await db.select({ id: notifications.id }).from(notifications))
    .map((row) => row.id)
    .sort()

test('F20-AC19: Given read and unread notices around their periods, When the sweep runs, Then only those past the period go, and the cut-off itself stays', async () => {
  await put('read-at-30d', ALICE, 1, NOW - READ_RETENTION_SECONDS)
  await put('read-past-30d', ALICE, 1, NOW - READ_RETENTION_SECONDS - 1)
  await put('unread-at-90d', ALICE, NOW - UNREAD_RETENTION_SECONDS, null)
  await put('unread-past-90d', ALICE, NOW - UNREAD_RETENTION_SECONDS - 1, null)
  // Unread for 40 days is kept; a notice read yesterday is kept however old.
  await put('unread-40d', ALICE, NOW - 40 * 86400, null)
  await put('read-yesterday', ALICE, 1, NOW - 86400)
  expect(await deleteExpiredNotifications(database, NOW)).toBe(2)
  expect(await ids()).toEqual([
    'read-at-30d',
    'read-yesterday',
    'unread-40d',
    'unread-at-90d',
  ])
})

test('F20-AC19: Given expired notices of two people, When one person’s are swept, Then only theirs go', async () => {
  await put('alice-old', ALICE, 1, NOW - READ_RETENTION_SECONDS - 5)
  await put('alice-new', ALICE, NOW - 10, null)
  await put('bob-old', BOB, 1, NOW - READ_RETENTION_SECONDS - 5)
  expect(
    await deleteExpiredNotifications(database, NOW, { userId: ALICE }),
  ).toBe(1)
  expect(await ids()).toEqual(['alice-new', 'bob-old'])
  expect(await countUnread(database, ALICE)).toBe(1)
})

test('F20-AC19: Given more expired notices than the limit, When the sweep runs, Then it deletes the limit and the next sweep the rest', async () => {
  for (const n of [1, 2, 3]) await put(`old-${n}`, ALICE, 1, 5)
  expect(await deleteExpiredNotifications(database, NOW, { limit: 2 })).toBe(2)
  expect(await deleteExpiredNotifications(database, NOW, { limit: 2 })).toBe(1)
  expect(await ids()).toEqual([])
})

test('F20-AC19: Given an expired notice, When the hourly Cron Trigger fires, Then it goes and a fresh one stays', async () => {
  await put('old', ALICE, 1, null)
  await put('fresh', ALICE, Math.floor(Date.now() / 1000), null)
  const waited: Promise<unknown>[] = []
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    await server.scheduled(
      { scheduledTime: Date.now(), cron: '17 * * * *', noRetry() {} },
      testEnv(platform.env),
      {
        waitUntil: (promise: Promise<unknown>) => waited.push(promise),
        passThroughOnException() {},
        props: {},
      } as unknown as ExecutionContext,
    )
    await Promise.allSettled(waited)
  } finally {
    log.mockRestore()
  }
  expect(await ids()).toEqual(['fresh'])
  expect(
    await db.select().from(notifications).where(eq(notifications.id, 'old')),
  ).toEqual([])
})
