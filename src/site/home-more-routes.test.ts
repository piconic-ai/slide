import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import type { HomeCommunityCard } from '../communities/community-card'
import { followCommunity, unfollowCommunity } from '../communities/follow-store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from '../communities/test-communities'
import { applyMigrations } from '../db/test-migrations'
import { follow } from '../follows/store'
import {
  OWNER_ID,
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import type { RecentDeck } from '../share/recent'
import type { HomeCommunityLists } from './home-communities'
import type { HomeLists } from './home-lists'
import { communityMoreQuery, deckMoreQuery, type DeckAfter } from './home-more'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

const BOB = '2'
const KANAGAWA = 61
let alice = ''

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await resetCommunities(db)
  alice = await signIn(env)
  await signIn(env, 'bob', { id: BOB })
})
afterAll(() => platform.dispose())

const open = (path: string, cookie = '') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )

const json = async <T>(path: string, cookie = ''): Promise<T> => {
  const response = await open(path, cookie)
  expect(response.status, path).toBe(200)
  return (await response.json()) as T
}

/** The sort keys of a card, as the page reads them to ask for more. */
const afterOf = (deck: RecentDeck): DeckAfter => ({
  at: Date.parse(deck.publishedAt) / 1000,
  handle: deck.handle,
  slug: deck.slug,
})

const hrefs = (cards: readonly { href: string }[]) =>
  cards.map((card) => card.href)

describe('the recent slides, page by page', () => {
  test('F03-AC163: Given slides, two of them published in the same second, When the list is read two at a time, Then each comes once in order, and one published in between neither repeats nor hides one', async () => {
    await seedPublic(db, 'd1', 100, 'One')
    await seedPublic(db, 'd2', 200, 'Two')
    await seedPublic(db, 'd3', 200, 'Three', BOB)
    await seedPublic(db, 'd4', 300, 'Four')
    await seedPublic(db, 'd5', 400, 'Five')

    const first = await json<RecentDeck[]>('/api/public/slides?limit=2')
    expect(hrefs(first)).toEqual(['/@owner/d5', '/@owner/d4'])

    const second = await json<RecentDeck[]>(
      `/api/public/slides${deckMoreQuery(afterOf(first[1]!), 1)}`,
    )
    // Same second: by handle, so bob's before owner's.
    expect(hrefs(second)).toEqual(['/@bob/d3', '/@owner/d2'])

    await seedPublic(db, 'd6', 500, 'Six')
    const third = await json<RecentDeck[]>(
      `/api/public/slides${deckMoreQuery(afterOf(second[1]!), 1)}`,
    )
    expect(hrefs(third)).toEqual(['/@owner/d1'])
  })

  test('F03-AC162: Given no limit, When the list is read, Then it reads the eight it always did', async () => {
    for (let i = 0; i < 10; i++) await seedPublic(db, `d${i}`, 100 + i, null)
    expect(await json<RecentDeck[]>('/api/public/slides')).toHaveLength(8)
  })

  test('F03-AC162: Given more slides than one press adds, When the list asks for the most a press may, Then it gets 101 and no more', async () => {
    for (let i = 0; i < 103; i++) await seedPublic(db, `d${i}`, 100 + i, null)
    expect(
      await json<RecentDeck[]>('/api/public/slides?limit=101'),
    ).toHaveLength(101)
  }, 30000)
})

describe('a malformed page', () => {
  test.each([
    ['/api/public/slides?limit=102'],
    ['/api/public/slides?at=1&handle=alice'],
    ['/api/public/communities?id=3'],
    ['/api/public/communities?limit=0'],
    ['/api/home?limit=x'],
    ['/api/home/communities?at=1&handle=alice&slug='],
  ])('Given %s, When it is asked for, Then it answers 400', async (path) => {
    expect((await open(path, alice)).status).toBe(400)
  })
})

describe('the slides of the people the visitor follows, page by page', () => {
  test('F03-AC163: Given three slides of a followed person, When they are read one at a time, Then each comes once, newest first', async () => {
    await follow(db, { follower: OWNER_ID, followee: BOB, now: 1 })
    for (const [slug, at] of [
      ['b1', 100],
      ['b2', 200],
      ['b3', 300],
    ] as const)
      await seedPublic(db, slug, at, slug, BOB)
    const seen: string[] = []
    let path = '/api/home?limit=1'
    for (let i = 0; i < 4; i++) {
      const { following } = await json<HomeLists>(path, alice)
      seen.push(...hrefs(following))
      const last = following.at(-1)
      if (!last) break
      path = `/api/home${deckMoreQuery(afterOf(last), 0)}`
    }
    expect(seen).toEqual(['/@bob/b3', '/@bob/b2', '/@bob/b1'])
  })
})

describe('the slides of the communities the visitor follows, page by page', () => {
  test('F03-AC163: Given three slides in a followed community, When they are read two at a time, Then each comes once, newest first', async () => {
    await seedCommunity(db, {
      id: KANAGAWA,
      handle: 'kanagawapm',
      links: ['https://kanagawapm.connpass.com/'],
      creator: OWNER_ID,
    })
    await unfollowCommunity(db, { userId: OWNER_ID, communityId: KANAGAWA })
    await followCommunity(db, {
      userId: OWNER_ID,
      communityId: KANAGAWA,
      now: 1,
    })
    for (const [slug, at] of [
      ['t1', 100],
      ['t2', 200],
      ['t3', 300],
    ] as const) {
      await seedPublic(db, slug, at, slug, BOB)
      await seedTalkLink(db, {
        deckId: slug,
        owner: BOB,
        url: `https://kanagawapm.connpass.com/event/${at}/`,
      })
    }
    const first = await json<HomeCommunityLists>(
      '/api/home/communities?limit=2',
      alice,
    )
    expect(hrefs(first.talks)).toEqual(['/@bob/t3', '/@bob/t2'])
    const second = await json<HomeCommunityLists>(
      `/api/home/communities${deckMoreQuery(afterOf(first.talks[1]!), 1)}`,
      alice,
    )
    expect(hrefs(second.talks)).toEqual(['/@bob/t1'])
  })
})

describe('the new communities, page by page', () => {
  test('F03-AC163: Given communities, two made in the same second, When they are read two at a time, Then each comes once, newest first, with its sort keys', async () => {
    for (const [id, now] of [
      [61, 10],
      [62, 20],
      [63, 20],
    ] as const)
      await seedCommunity(db, {
        id,
        handle: `c${id}`,
        links: [`https://c${id}.connpass.com/`],
        now,
      })
    const first = await json<HomeCommunityCard[]>(
      '/api/public/communities?limit=2',
    )
    expect(first.map((card) => card.after)).toEqual([
      { at: 20, id: 63 },
      { at: 20, id: 62 },
    ])
    const second = await json<HomeCommunityCard[]>(
      `/api/public/communities${communityMoreQuery(first[1]!.after, 1)}`,
    )
    expect(hrefs(second)).toEqual(['/@c61'])
  })
})
