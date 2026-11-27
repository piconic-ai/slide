import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { followCommunity, unfollowCommunity } from '../communities/follow-store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from '../communities/test-communities'
import {
  accounts,
  blocks,
  decks,
  mutes,
  profilePictures,
  profiles,
  suspensions,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { follow } from '../follows/store'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import type { FollowingDeck, HomeDiscover } from './home-discover'
import { deckMoreQuery, type DeckAfter } from './home-more'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

const BOB = '2'
const CAROL = '3'
const DAVE = '4'
const KANAGAWA = 61
const OSAKA = 62
let alice = ''

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await resetCommunities(db)
  alice = await signIn(env)
  await orm.insert(accounts).values([
    { user_id: BOB, handle: 'bob', created_at: 10 },
    { user_id: CAROL, handle: 'carol', created_at: 20 },
    { user_id: DAVE, handle: 'dave', created_at: 30 },
  ])
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

const following = (query = '', cookie = alice) =>
  json<FollowingDeck[] | null>(`/api/home/following-slides${query}`, cookie)

const hrefs = (cards: readonly { href: string }[] | null) =>
  (cards ?? []).map((card) => card.href)

const afterOf = (deck: FollowingDeck): DeckAfter => ({
  at: Date.parse(deck.publishedAt) / 1000,
  handle: deck.handle,
  slug: deck.slug,
})

/** Alice follows the community; the community a talk is in is by its link. */
const followKanagawa = async (id = KANAGAWA, handle = 'kanagawapm') => {
  await seedCommunity(db, {
    id,
    handle,
    links: [`https://${handle}.connpass.com/`],
    creator: OWNER_ID,
    now: 5,
  })
  await unfollowCommunity(db, { userId: OWNER_ID, communityId: id })
  await followCommunity(db, { userId: OWNER_ID, communityId: id, now: 1 })
}

const talkIn = async (
  slug: string,
  at: number,
  owner: string,
  handle = 'kanagawapm',
) => {
  await seedPublic(db, slug, at, slug, owner)
  await seedTalkLink(db, {
    deckId: slug,
    owner,
    url: `https://${handle}.connpass.com/event/${at}/`,
  })
}

describe('the "following" tab', () => {
  test('F44-AC5: Given Alice follows Bob and a community, When she asks, Then the slides of both come as one list, newest first, each with its source', async () => {
    await follow(db, { follower: OWNER_ID, followee: BOB, now: 1 })
    await followKanagawa()
    await seedPublic(db, 'bobs', 300, 'Bob’s', BOB)
    await talkIn('carols-talk', 200, CAROL)
    await seedPublic(db, 'strangers', 400, 'Stranger’s', DAVE)
    await orm.insert(profilePictures).values({ user_id: BOB, uploaded_at: 42 })
    const list = await following()
    expect(hrefs(list)).toEqual(['/@bob/bobs', '/@carol/carols-talk'])
    // Each card carries its own author's face, read in the same query.
    expect(list?.map((deck) => deck.authorAvatarUrl)).toEqual([
      `/avatars/${BOB}?v=u42`,
      `/avatars/${CAROL}?v=g`,
    ])
    expect(list?.map((deck) => deck.source)).toEqual([
      { kind: 'person' },
      {
        kind: 'community',
        name: 'kanagawapm',
        href: '/@kanagawapm',
        color: 'red',
      },
    ])
  })

  test('F44-AC5: Given a slide of a followed person that is also in two followed communities, When she asks, Then it comes once, under the community she followed first', async () => {
    await follow(db, { follower: OWNER_ID, followee: BOB, now: 1 })
    await followKanagawa()
    await followKanagawa(OSAKA, 'osakapm')
    // The later follow, though its id is the smaller one.
    await unfollowCommunity(db, { userId: OWNER_ID, communityId: OSAKA })
    await followCommunity(db, {
      userId: OWNER_ID,
      communityId: OSAKA,
      now: 9,
    })
    await seedPublic(db, 'both', 300, 'Both', BOB)
    for (const [index, handle] of ['kanagawapm', 'osakapm'].entries())
      await seedTalkLink(db, {
        deckId: 'both',
        owner: BOB,
        url: `https://${handle}.connpass.com/event/${7 + index}/`,
      })
    const list = await following()
    expect(hrefs(list)).toEqual(['/@bob/both'])
    // The author is followed too, and the community is what the card shows.
    expect(list?.[0]?.source).toMatchObject({
      kind: 'community',
      name: 'kanagawapm',
    })
  })

  test('F44-AC5: Given a follower of nobody, or of people without a public slide, When she asks, Then the list is empty, not missing', async () => {
    expect(await following()).toEqual([])
    await follow(db, { follower: OWNER_ID, followee: BOB, now: 1 })
    await seedDeck(db, 'draft', BOB)
    expect(await following()).toEqual([])
  })

  test('F44-AC6: Given followed people and a community, When some are muted, blocked, suspended or hidden, Then their slides are left out', async () => {
    for (const person of [BOB, CAROL, DAVE])
      await follow(db, { follower: OWNER_ID, followee: person, now: 1 })
    await followKanagawa()
    await seedPublic(db, 'bobs', 500, 'Bob’s', BOB)
    await seedPublic(db, 'carols', 400, 'Carol’s', CAROL)
    await seedPublic(db, 'daves', 300, 'Dave’s', DAVE)
    await talkIn('daves-talk', 200, DAVE)
    await seedPublic(db, 'hidden', 100, 'Hidden', CAROL)
    expect(hrefs(await following())).toEqual([
      '/@bob/bobs',
      '/@carol/carols',
      '/@dave/daves',
      '/@dave/daves-talk',
      '/@carol/hidden',
    ])
    // A mute beside a follow that stayed, a block, a suspension and a takedown.
    await orm
      .insert(mutes)
      .values({ muter_user_id: OWNER_ID, muted_user_id: BOB, created_at: 1 })
    await orm.insert(blocks).values({
      blocker_user_id: OWNER_ID,
      blocked_user_id: DAVE,
      created_at: 1,
    })
    await orm
      .update(decks)
      .set({ hidden_at: 1, hidden_reason: 'x', hidden_by: 'op' })
      .where(eq(decks.id, 'hidden'))
    expect(hrefs(await following())).toEqual(['/@carol/carols'])
    await orm.insert(suspensions).values({
      user_id: CAROL,
      reason: 'test',
      suspended_at: 1,
      suspended_by: 'operator',
    })
    expect(await following()).toEqual([])
  })

  test('F44-AC6: Given a talk of a blocked author in a followed community, When she asks, Then it is left out (as the followed communities’ list always did)', async () => {
    await followKanagawa()
    await talkIn('blocked-talk', 200, BOB)
    await talkIn('fine-talk', 100, CAROL)
    await orm.insert(blocks).values({
      blocker_user_id: OWNER_ID,
      blocked_user_id: BOB,
      created_at: 1,
    })
    expect(hrefs(await following())).toEqual(['/@carol/fine-talk'])
  })

  test('F44-AC13: Given five slides, two published in the same second, When they are read two at a time, Then each comes once in order, and one published in between neither repeats nor hides one', async () => {
    await follow(db, { follower: OWNER_ID, followee: BOB, now: 1 })
    await follow(db, { follower: OWNER_ID, followee: CAROL, now: 1 })
    await seedPublic(db, 'd1', 100, 'One', BOB)
    await seedPublic(db, 'd2', 200, 'Two', BOB)
    await seedPublic(db, 'd3', 200, 'Three', CAROL)
    await seedPublic(db, 'd4', 300, 'Four', BOB)
    await seedPublic(db, 'd5', 400, 'Five', CAROL)
    const first = (await following('?limit=2'))!
    expect(hrefs(first)).toEqual(['/@carol/d5', '/@bob/d4'])
    const second = (await following(deckMoreQuery(afterOf(first[1]!), 1)))!
    expect(hrefs(second)).toEqual(['/@bob/d2', '/@carol/d3'])
    await seedPublic(db, 'd6', 500, 'Six', BOB)
    const third = (await following(deckMoreQuery(afterOf(second[1]!), 1)))!
    expect(hrefs(third)).toEqual(['/@bob/d1'])
  })

  test('F44-AC12: Given no limit, When the list is read, Then it reads the twelve the timeline shows first', async () => {
    await follow(db, { follower: OWNER_ID, followee: BOB, now: 1 })
    for (let i = 0; i < 14; i++)
      await seedPublic(db, `d${i}`, 100 + i, null, BOB)
    expect(await following()).toHaveLength(12)
  }, 30000)

  test('F44-AC8: Given no session or a forged one, When the list is asked for, Then nothing is answered and no cache may keep it', async () => {
    for (const cookie of ['', '__Host-slide_owner=forged.value']) {
      const response = await open('/api/home/following-slides', cookie)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('null')
      expect(response.headers.get('Cache-Control')).toContain(
        'private, no-store',
      )
      expect(response.headers.get('Vary')).toContain('Cookie')
    }
  })

  test.each([
    ['?limit=102'],
    ['?limit=0'],
    ['?at=1&handle=alice'],
    ['?at=x&handle=alice&slug=a'],
  ])('Given %s, When it is asked for, Then it answers 400', async (query) => {
    expect(
      (await open(`/api/home/following-slides${query}`, alice)).status,
    ).toBe(400)
  })
})

const discover = (cookie = '') =>
  json<HomeDiscover>('/api/home/discover', cookie)

describe('the carousels', () => {
  test('F44-AC17: Given people registered at different times, When Alice asks, Then the newest come first, whether or not they published, and not herself', async () => {
    await seedPublic(db, 'bobs', 100, 'Bob’s', BOB)
    const { people, signedIn } = await discover(alice)
    expect(signedIn).toBe(true)
    expect(people.map((person) => person.handle)).toEqual([
      'dave',
      'carol',
      'bob',
    ])
  })

  test('F44-AC17: Given people Alice follows, muted, blocked, who blocked her, or who are suspended, When she asks, Then none of them is listed', async () => {
    await follow(db, { follower: OWNER_ID, followee: BOB, now: 1 })
    await orm
      .insert(mutes)
      .values({ muter_user_id: OWNER_ID, muted_user_id: CAROL, created_at: 1 })
    await orm.insert(blocks).values({
      blocker_user_id: DAVE,
      blocked_user_id: OWNER_ID,
      created_at: 1,
    })
    const EVE = '5'
    const FRANK = '6'
    await orm.insert(accounts).values([
      { user_id: EVE, handle: 'eve', created_at: 40 },
      { user_id: FRANK, handle: 'frank', created_at: 50 },
    ])
    await orm.insert(blocks).values({
      blocker_user_id: OWNER_ID,
      blocked_user_id: EVE,
      created_at: 1,
    })
    await orm.insert(suspensions).values({
      user_id: FRANK,
      reason: 'test',
      suspended_at: 1,
      suspended_by: 'operator',
    })
    expect((await discover(alice)).people).toEqual([])
  })

  test('F44-AC17: Given a visitor who is not signed in, When they ask, Then everybody but the suspended is listed, newest first, and the answer may be cached for a minute', async () => {
    await orm.insert(suspensions).values({
      user_id: CAROL,
      reason: 'test',
      suspended_at: 1,
      suspended_by: 'operator',
    })
    const response = await open('/api/home/discover')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60')
    expect(response.headers.get('Vary')).toContain('Cookie')
    const answer = (await response.json()) as HomeDiscover
    expect(answer.signedIn).toBe(false)
    expect(answer.people.map((person) => person.handle)).toEqual([
      'dave',
      'bob',
      'owner',
    ])
  })

  test('F44-AC19: Given a person who wrote a name, a bio, a place and a site, When the carousel reads them, Then only the name, the handle, the link and the picture come', async () => {
    await orm.insert(profiles).values({
      user_id: BOB,
      name: 'Bob <b>B.</b>',
      bio: 'bio-text',
      location: 'place-text',
      website: 'https://site.example',
      use_gravatar: 0,
    })
    const bob = (await discover(alice)).people.find(
      (person) => person.handle === 'bob',
    )
    expect(bob).toEqual({
      handle: 'bob',
      name: 'Bob <b>B.</b>',
      href: '/@bob',
      avatarUrl: expect.stringMatching(/^\/avatars\/2\?v=/),
      initial: 'B',
      followsYou: false,
    })
    expect(JSON.stringify(bob)).not.toMatch(/bio-text|place-text|site\.example/)
  })

  test('F44-AC32: Given Bob follows Alice and Carol does not, When Alice reads the carousel, Then only Bob’s card is marked as following her, and nothing else of it comes', async () => {
    await follow(db, { follower: BOB, followee: OWNER_ID, now: 5 })
    const { people } = await discover(alice)
    expect(people.map((person) => [person.handle, person.followsYou])).toEqual(
      expect.arrayContaining([
        ['bob', true],
        ['carol', false],
      ]),
    )
    expect((await discover('')).people.every((p) => !p.followsYou)).toBe(true)
  })

  test('F44-AC19: Given a person with no profile row, When the carousel reads them, Then their handle stands for the name', async () => {
    const carol = (await discover(alice)).people.find(
      (person) => person.handle === 'carol',
    )
    expect(carol).toMatchObject({ name: 'carol', initial: 'C' })
  })

  test('F44-AC18: Given communities made at different times and Alice follows one, When she asks, Then the newest come first without the one she follows', async () => {
    for (const [id, now] of [
      [61, 10],
      [62, 20],
      [63, 30],
    ] as const)
      await seedCommunity(db, {
        id,
        handle: `c${id}`,
        links: [`https://c${id}.connpass.com/`],
        creator: BOB,
        now,
      })
    await followCommunity(db, { userId: OWNER_ID, communityId: 62, now: 40 })
    expect(
      (await discover(alice)).communities.map((card) => card.handle),
    ).toEqual(['c63', 'c61'])
    // A visitor who is not signed in follows none.
    expect((await discover()).communities.map((card) => card.handle)).toEqual([
      'c63',
      'c62',
      'c61',
    ])
  })

  test('F44-AC20: Given a community with a description, When the carousel reads it, Then its logo, name, description and link come, and no count', async () => {
    await seedCommunity(db, {
      id: 70,
      handle: 'kanagawapm',
      name: 'Kanagawa.pm 🐪',
      links: ['https://kanagawapm.connpass.com/'],
      creator: BOB,
    })
    const [card] = (await discover()).communities
    expect(card).toMatchObject({
      handle: 'kanagawapm',
      name: 'Kanagawa.pm 🐪',
      href: '/@kanagawapm',
      logo: { kind: 'initial', letter: 'K' },
    })
    expect(Object.keys(card!).sort()).toEqual([
      'description',
      'handle',
      'href',
      'logo',
      'name',
    ])
  })

  test('F44-AC17: Given more people than a carousel holds, When it is asked for, Then twelve come', async () => {
    await orm.insert(accounts).values(
      Array.from({ length: 15 }, (_, i) => ({
        user_id: `9${i}`,
        handle: `p${i}`,
        created_at: 100 + i,
      })),
    )
    expect((await discover(alice)).people).toHaveLength(12)
  })

  test('F44-AC18: Given nobody and no community, When the carousels are asked for, Then both are empty lists, not missing', async () => {
    await resetTables(db)
    await resetCommunities(db)
    expect(await discover()).toEqual({
      signedIn: false,
      people: [],
      communities: [],
    })
  })
})
