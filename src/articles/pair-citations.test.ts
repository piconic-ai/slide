import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { accounts, citations } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  countPairs,
  listPairs,
  readCitedCounts,
  type PairSide,
} from '../citations/pair-store'
import {
  OWNER_ID,
  resetTables,
  seedPublic,
  signIn,
  testEnv,
} from '../publication/test-support'
import { keepArticle, unpublishArticle } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = testEnv(platform.env)
const READER_ID = '999'
const version: Record<string, string> = {}

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await signIn(env)
  await orm
    .insert(accounts)
    .values({ user_id: READER_ID, handle: 'reader', created_at: 1 })
  version.talk = await seedPublic(db, 'talk', 1, 'Talk')
  version.reply = await seedPublic(db, 'reply', 2, 'Reply', READER_ID)
  await seedPublic(db, 'mine2', 3, 'Mine too')
})
afterAll(() => platform.dispose())

const article = (
  deck: string,
  links: [string, string, number][],
  status: 'draft' | 'published' = 'published',
) =>
  keepArticle(db, {
    deckId: deck,
    body: 'text',
    status,
    citations: links.map(([handle, slug, page]) => ({ handle, slug, page })),
    now: 5,
  })

const side = (which: PairSide, author: string) =>
  listPairs(db, { side: which, author, viewer: null, limit: 50, offset: 0 })
const count = (which: PairSide, author: string) =>
  countPairs(db, { side: which, author, viewer: null })

test('F24-AC22, F24-AC23: Given a published article that links to another author’s deck, When both profiles are read, Then the cited author lists the citing deck and the citing author lists the cited one, and the numbers agree', async () => {
  await article('reply', [['owner', 'talk', 3]])
  expect((await side('cited', OWNER_ID)).map((row) => row.slug)).toEqual([
    'reply',
  ])
  expect((await side('citing', READER_ID)).map((row) => row.slug)).toEqual([
    'talk',
  ])
  expect(await count('cited', OWNER_ID)).toBe(1)
  expect(await count('citing', READER_ID)).toBe(1)
  expect((await readCitedCounts(db, ['owner'], null)).get('owner/talk')).toBe(1)
})

test('F24-AC24: Given a deck that cites another both in its slides and in its article, When the profile is read, Then it is one row and one in the number', async () => {
  await orm.insert(citations).values({
    deployment_id: version.reply!,
    target_handle: 'owner',
    target_slug: 'talk',
    target_page: 6,
  })
  await article('reply', [
    ['owner', 'talk', 3],
    ['owner', 'talk', 0],
  ])
  expect(await side('cited', OWNER_ID)).toHaveLength(1)
  expect(await count('cited', OWNER_ID)).toBe(1)
  expect((await readCitedCounts(db, ['owner'], null)).get('owner/talk')).toBe(1)
})

test('F24-AC20, F24-AC24: Given an article citation, When the article is unpublished and published again, Then the row leaves the profile and comes back', async () => {
  await article('reply', [['owner', 'talk', 3]])
  await unpublishArticle(db, 'reply')
  expect(await side('cited', OWNER_ID)).toEqual([])
  expect(await count('cited', OWNER_ID)).toBe(0)
  await article('reply', [['owner', 'talk', 3]])
  expect(await count('cited', OWNER_ID)).toBe(1)
})

test('F24-AC20: Given a draft article, When the profile is read, Then it counts nothing, even if citation rows were left behind', async () => {
  await article('reply', [['owner', 'talk', 3]], 'draft')
  expect(await count('cited', OWNER_ID)).toBe(0)
  await article('reply', [['owner', 'talk', 3]])
  await unpublishArticle(db, 'reply')
  expect(await count('cited', OWNER_ID)).toBe(0)
})

test('F24-AC25: Given an article of one author’s deck that links to another of their decks, When their profile is read, Then it is in neither list nor number', async () => {
  await article('mine2', [['owner', 'talk', 1]])
  expect(await side('cited', OWNER_ID)).toEqual([])
  expect(await side('citing', OWNER_ID)).toEqual([])
  expect(await count('cited', OWNER_ID)).toBe(0)
})

test('F24-AC26: Given an article citation, When the citing deck is no longer public, Then its row leaves the cited author’s profile', async () => {
  await article('reply', [['owner', 'talk', 3]])
  await orm.$client
    .prepare('UPDATE decks SET public_deployment_id = NULL WHERE id = ?')
    .bind('reply')
    .run()
  expect(await count('cited', OWNER_ID)).toBe(0)
})
