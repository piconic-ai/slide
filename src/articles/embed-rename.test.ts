import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { accounts, profiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { renameHandle } from '../handles/store'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedPublic,
} from '../publication/test-support'
import type { Handle } from '../share/handle'
import { resolveEmbeds } from './embed-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const contentBase = new URL('https://content.example')
const CAROL = 'u-carol'

let aliceVersion = ''

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  await db.insert(accounts).values([
    { user_id: OWNER_ID, handle: 'alice', created_at: 1 },
    { user_id: INVITED_ID, handle: 'bob', created_at: 1 },
    { user_id: CAROL, handle: 'carol', created_at: 1 },
  ])
  await db.insert(profiles).values([
    { user_id: OWNER_ID, name: 'Alice' },
    { user_id: INVITED_ID, name: 'Bob' },
  ])
  aliceVersion = await seedPublic(
    database,
    'a',
    10,
    'Alice talk',
    OWNER_ID,
    'talk',
  )
  await seedPublic(database, 'b', 20, 'Bob talk', INVITED_ID, 'bob-talk')
  await seedPublic(database, 'c', 30, 'Carol talk', CAROL, 'carol-talk')
})
afterAll(() => platform.dispose())

/** The pages an article wrote before any handle changed. */
const pages = [
  { handle: 'alice', slug: 'talk', page: 2 },
  { handle: 'bob', slug: 'bob-talk', page: 3 },
]

const rename = (id: string, to: string) =>
  renameHandle(database, {
    owner: { kind: 'person', id },
    to: to as Handle,
    now: 1000,
  })

test('F30-AC7: Given alice’s article embeds her own page and bob’s page, When an operator changes alice’s handle, Then the article shows the same pages', async () => {
  const embedsOf = (handle: string) =>
    resolveEmbeds(database, {
      pages,
      own: {
        handle,
        slug: 'talk',
        version: { id: aliceVersion, coverPath: null },
      },
      contentBase,
    })
  const before = await embedsOf('alice')
  expect([...before.values()].map((embed) => embed.kind)).toEqual([
    'own',
    'other',
  ])
  expect(await rename(OWNER_ID, 'alice-new')).toBe('renamed')
  // The viewer reads the deck under its owner's handle now.
  expect(await embedsOf('alice-new')).toEqual(before)
})

test('F30-AC7: Given carol’s article embeds alice’s and bob’s pages, When an operator changes both handles, Then the article shows the same pages with the same authors', async () => {
  const embeds = () =>
    resolveEmbeds(database, {
      pages,
      own: { handle: 'carol', slug: 'carol-talk', version: null },
      contentBase,
    })
  const before = await embeds()
  expect([...before.values()]).toMatchObject([
    { kind: 'other', title: 'Alice talk', author: 'Alice' },
    { kind: 'other', title: 'Bob talk', author: 'Bob' },
  ])
  expect(await rename(OWNER_ID, 'alice-new')).toBe('renamed')
  expect(await rename(INVITED_ID, 'bob-new')).toBe('renamed')
  expect(await embeds()).toEqual(before)
})

test('F30-AC7: Given a changed handle that someone took again after the hold, When an article embeds a page under it, Then the new holder’s slides are looked up, not the moved person’s', async () => {
  expect(await rename(INVITED_ID, 'bob-new')).toBe('renamed')
  await db
    .insert(accounts)
    .values({ user_id: 'u-new-bob', handle: 'bob', created_at: 2 })
  const found = await resolveEmbeds(database, {
    pages,
    own: { handle: 'carol', slug: 'carol-talk', version: null },
    contentBase,
  })
  expect([...found.keys()]).toEqual(['alice/talk/2'])
})
