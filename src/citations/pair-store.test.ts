import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import {
  accounts,
  citations,
  decks,
  deployments,
  mutes,
  profiles,
  suspensions,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  OWNER_ID,
  resetTables,
  seedPublic,
  signIn,
  testEnv,
} from '../publication/test-support'
import {
  countPairs,
  listPairs,
  PAIRS_PER_PAGE,
  readCitedCounts,
  type PairSide,
} from './pair-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = testEnv(platform.env)

const READER_ID = '999'
const CAROL_ID = '777'

/** The deployments of the decks, by deck name. */
const version: Record<string, string> = {}

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  // Signing in records the handle "owner".
  await signIn(env)
  await orm.insert(accounts).values([
    { user_id: READER_ID, handle: 'reader', created_at: 1 },
    { user_id: CAROL_ID, handle: 'carol', created_at: 1 },
  ])
  await orm.insert(profiles).values({ user_id: READER_ID, name: 'Reader Name' })
  version.talk = await seedPublic(db, 'talk', 1, 'Talk')
  version.reply = await seedPublic(db, 'reply', 2, 'Reply', READER_ID)
  version.note = await seedPublic(db, 'note', 3, 'Note', CAROL_ID)
})
afterAll(() => platform.dispose())

const cite = (from: string, handle: string, slug: string, page = 0) =>
  orm.insert(citations).values({
    deployment_id: version[from]!,
    target_handle: handle,
    target_slug: slug,
    target_page: page,
  })

const list = (
  side: PairSide,
  author: string,
  viewer: string | null = null,
  offset = 0,
  limit = PAIRS_PER_PAGE,
) => listPairs(db, { side, author, viewer, limit, offset })

const names = async (...args: Parameters<typeof list>) =>
  (await list(...args)).map((row) => `${row.handle}/${row.slug}`)

const hide = (deckId: string) =>
  applyOperatorCommand(db, {
    deckId,
    command: { kind: 'hide', reason: 'spam', operator: 'op' },
    now: 5,
  })

const suspend = (userId: string) =>
  orm.insert(suspensions).values({
    user_id: userId,
    reason: 'spam',
    suspended_at: 5,
    suspended_by: 'op',
  })

const mute = (muter: string, muted: string) =>
  orm
    .insert(mutes)
    .values({ muter_user_id: muter, muted_user_id: muted, created_at: 1 })

test('F24-AC22, F24-AC23: Given another author’s deck citing mine, When both profiles’ lists are read, Then mine lists the citing deck as cited and theirs lists mine as citing', async () => {
  await cite('reply', 'owner', 'talk', 6)

  expect(await list('cited', OWNER_ID)).toEqual([
    {
      handle: 'reader',
      slug: 'reply',
      title: 'Reply',
      authorName: 'Reader Name',
      deploymentId: version.reply,
      coverPath: null,
      ownTitle: 'Talk',
      ownSlug: 'talk',
      at: 2,
    },
  ])
  expect(await names('citing', READER_ID)).toEqual(['owner/talk'])
  expect((await list('citing', READER_ID))[0]?.ownTitle).toBe('Reply')
  expect(await list('citing', OWNER_ID)).toEqual([])
  expect(await list('cited', READER_ID)).toEqual([])
})

test('F24-AC24: Given a deck citing another at several pages and as a whole, When the list and the count are read, Then the pair is one row', async () => {
  await cite('reply', 'owner', 'talk', 6)
  await cite('reply', 'owner', 'talk', 24)
  await cite('reply', 'owner', 'talk', 0)

  expect(await names('cited', OWNER_ID)).toEqual(['reader/reply'])
  expect(
    await countPairs(db, { side: 'cited', author: OWNER_ID, viewer: null }),
  ).toBe(1)
})

test('F24-AC25: Given two decks of one author citing each other, When their lists and count are read, Then they hold nothing, while a deck of another author still counts', async () => {
  version.sequel = await seedPublic(db, 'sequel', 4, 'Sequel')
  await cite('sequel', 'owner', 'talk')

  for (const side of ['cited', 'citing'] as const) {
    expect(await list(side, OWNER_ID)).toEqual([])
    expect(await countPairs(db, { side, author: OWNER_ID, viewer: null })).toBe(
      0,
    )
  }
})

test('F24-AC26: Given a citing deck that stops being public, When the list and the count are read, Then its row and its count are gone, and back once public', async () => {
  await cite('reply', 'owner', 'talk', 6)
  const count = () =>
    countPairs(db, { side: 'cited', author: OWNER_ID, viewer: null })
  expect(await count()).toBe(1)
  await orm
    .update(decks)
    .set({ public_deployment_id: null })
    .where(eq(decks.id, 'reply'))

  expect(await names('cited', OWNER_ID)).toEqual([])
  expect(await count()).toBe(0)
  await orm
    .update(decks)
    .set({ public_deployment_id: version.reply! })
    .where(eq(decks.id, 'reply'))
  expect(await count()).toBe(1)
})

test('F24-AC26: Given a cited deck that stops being public, When the citing author’s list is read, Then the row is gone', async () => {
  await cite('reply', 'owner', 'talk', 6)
  await orm
    .update(decks)
    .set({ public_deployment_id: null })
    .where(eq(decks.id, 'talk'))

  expect(await names('citing', READER_ID)).toEqual([])
})

test('F24-AC27: Given a reader who muted the citing author, When the lists and counts are read, Then that reader loses the row and the count and everyone else keeps them', async () => {
  await cite('reply', 'owner', 'talk', 6)
  await cite('note', 'owner', 'talk', 1)
  await mute(OWNER_ID, READER_ID)

  const seen = (viewer: string | null) => names('cited', OWNER_ID, viewer)
  expect(await seen(OWNER_ID)).toEqual(['carol/note'])
  expect(await seen(null)).toHaveLength(2)
  expect(await seen(CAROL_ID)).toHaveLength(2)
  expect(
    await countPairs(db, { side: 'cited', author: OWNER_ID, viewer: OWNER_ID }),
  ).toBe(1)
  expect(
    await countPairs(db, { side: 'cited', author: OWNER_ID, viewer: null }),
  ).toBe(2)
})

test('F24-AC27: Given a reader who muted the cited author, When the citing author’s list is read, Then that reader does not see the row', async () => {
  await cite('reply', 'owner', 'talk', 6)
  await mute(CAROL_ID, OWNER_ID)

  expect(await names('citing', READER_ID, CAROL_ID)).toEqual([])
  expect(await names('citing', READER_ID, null)).toEqual(['owner/talk'])
})

test.each([
  ['a hidden citing deck', async () => hide('reply')],
  ['a hidden cited deck', async () => hide('talk')],
  ['a suspended citing author', async () => suspend(READER_ID)],
  ['a suspended cited author', async () => suspend(OWNER_ID)],
])(
  'F24-AC28: Given %s, When both lists and counts are read by anyone, Then the pair is in none of them',
  async (_name, stop) => {
    await cite('reply', 'owner', 'talk', 6)
    await stop()

    for (const [side, author] of [
      ['cited', OWNER_ID],
      ['citing', READER_ID],
    ] as const) {
      expect(await list(side, author)).toEqual([])
      expect(await countPairs(db, { side, author, viewer: null })).toBe(0)
    }
    expect((await readCitedCounts(db, ['owner'], null)).size).toBe(0)
  },
)

test('F24-AC29: Given citing decks made public on different days, When the list is read, Then the newest pair is first', async () => {
  await cite('reply', 'owner', 'talk', 1)
  await cite('note', 'owner', 'talk', 1)

  expect(await names('cited', OWNER_ID)).toEqual(['carol/note', 'reader/reply'])
})

test('F24-AC30: Given more pairs than a page, When the pages are read, Then 50 come first, the 51st is on the next page and the count is all of them', async () => {
  for (let n = 1; n <= PAIRS_PER_PAGE + 1; n++) {
    version[`d${n}`] = await seedPublic(db, `d${n}`, 100 + n, `D${n}`, CAROL_ID)
    await cite(`d${n}`, 'owner', 'talk')
  }

  const first = await list('cited', OWNER_ID)
  const second = await list('cited', OWNER_ID, null, PAIRS_PER_PAGE)
  expect(first).toHaveLength(PAIRS_PER_PAGE)
  expect(first[0]?.slug).toBe('d51')
  expect(second.map((row) => row.slug)).toEqual(['d1'])
  expect(
    await countPairs(db, { side: 'cited', author: OWNER_ID, viewer: null }),
  ).toBe(PAIRS_PER_PAGE + 1)
}, 60_000)

test('F24-AC33, F24-AC34: Given decks cited by decks of other authors, When the cards’ counts are read, Then a cited deck has its count and an uncited one has none', async () => {
  await cite('reply', 'owner', 'talk', 1)
  await cite('note', 'owner', 'talk', 2)

  const counts = await readCitedCounts(db, ['owner', 'reader'], null)
  expect(counts.get('owner/talk')).toBe(2)
  expect(counts.has('reader/reply')).toBe(false)
  expect([...counts.keys()]).toEqual(['owner/talk'])
  expect(
    (await readCitedCounts(db, ['owner'], OWNER_ID)).get('owner/talk'),
  ).toBe(2)
  expect(await readCitedCounts(db, [], null)).toEqual(new Map())
})

test('F24-AC33: Given a reader who muted one citing author, When the cards’ counts are read, Then the reader’s count leaves that author out', async () => {
  await cite('reply', 'owner', 'talk', 1)
  await cite('note', 'owner', 'talk', 2)
  await mute(OWNER_ID, READER_ID)

  expect(
    (await readCitedCounts(db, ['owner'], OWNER_ID)).get('owner/talk'),
  ).toBe(1)
})

test('F24-AC33: Given 120 authors’ decks, each cited by one deck, and a repeated handle, When the cards’ counts are read, Then every one is counted and no statement binds more than D1 allows', async () => {
  const handles: string[] = []
  for (let n = 1; n <= 120; n++) {
    const id = String(8000 + n)
    await orm
      .insert(accounts)
      .values({ user_id: id, handle: `a${n}`, created_at: 1 })
    version[`x${n}`] = await seedPublic(db, `x${n}`, 10, `X${n}`, id)
    await cite('reply', `a${n}`, `x${n}`)
    handles.push(`a${n}`)
  }

  const counts = await readCitedCounts(db, [...handles, 'a1', 'a1'], OWNER_ID)

  expect(counts.size).toBe(120)
  expect(counts.get('a120/x120')).toBe(1)
  expect(counts.get('a1/x1')).toBe(1)
}, 120_000)
