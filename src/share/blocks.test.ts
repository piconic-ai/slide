import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { blocks, citations, follows, notifications } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  countUnread,
  listNotifications,
  notifyCited,
} from '../notifications/store'
import {
  INVITED_ID,
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const CAROL_ID = '999'
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
let alice = ''
let carol = ''
let bob = ''

const bobTalk = '/@bob/bob-talk'
const carolTalks = [1, 2, 3, 4, 5].map((n) => `/@carol/carol-${n}`)

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  carol = await signIn(env, 'carol', { id: CAROL_ID })
  bob = await signIn(env, 'bob', { id: INVITED_ID })
  // Alice's main deck cites, and is cited by, Bob's talk and Carol's five,
  // Bob's first: with four cards shown, blocking Bob promotes a talk and
  // changes the overflow count.
  const main = await seedPublic(database, 'main', 1, 'Main', OWNER_ID)
  const talks = [
    { owner: INVITED_ID, handle: 'bob', slug: 'bob-talk' },
    ...[1, 2, 3, 4, 5].map((n) => ({
      owner: CAROL_ID,
      handle: 'carol',
      slug: `carol-${n}`,
    })),
  ]
  for (const [index, { owner, handle, slug }] of talks.entries()) {
    const id = await seedPublic(database, slug, 100 - index, slug, owner)
    await db.insert(citations).values([
      { deployment_id: main, target_handle: handle, target_slug: slug },
      { deployment_id: id, target_handle: 'alice', target_slug: 'main' },
    ])
  }
})
beforeEach(async () => {
  await db.batch([
    db.delete(blocks),
    db.delete(follows),
    db.delete(notifications),
  ])
})
afterAll(() => platform.dispose())

const get = (path: string, cookie = '') =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )

const aliceBlocksBob = () =>
  db.insert(blocks).values({
    blocker_user_id: OWNER_ID,
    blocked_user_id: INVITED_ID,
    created_at: 200,
  })

async function recent(cookie: string) {
  const response = await get('/api/public/slides', cookie)
  expect(response.status).toBe(200)
  return ((await response.json()) as { href: string }[]).map(
    (deck) => deck.href,
  )
}

async function following(cookie: string) {
  const response = await get('/api/home', cookie)
  expect(response.status).toBe(200)
  const body = (await response.json()) as {
    following: { href: string }[]
  }
  return body.following.map((deck) => deck.href)
}

/** The cards and the overflow count of one of the viewer's reader lists. */
async function readerList(cookie: string, name: 'cites' | 'cited-by') {
  const page = await (await get('/@alice/main', cookie)).text()
  const list =
    new RegExp(
      `<div data-reader-lists="${name}">([\\s\\S]*?)</div>\\s*(?:<div data-reader-lists|</main>)`,
    ).exec(page)?.[1] ?? ''
  return {
    cards: [...list.matchAll(/<a class="card-title" href="([^"]+)">/g)].map(
      (card) => card[1],
    ),
    more: Number(
      /<p class="citations-more">\s*ほか (\d+) 件\s*<\/p>/.exec(list)?.[1] ??
        '0',
    ),
  }
}

/** The rows and the tab's count of Alice's cited list, as `cookie` reads it. */
async function citedList(cookie: string) {
  const page = await (await get('/@alice/cited', cookie)).text()
  return {
    rows: [...page.matchAll(/<a class="citation-title" href="([^"]+)"/g)].map(
      (match) => match[1],
    ),
    count: Number(
      /href="\/@alice\/cited"[^>]*>[^<]*<span class="count">(\d+)<\/span>/.exec(
        page,
      )?.[1],
    ),
  }
}

test('F32-AC3: Given Alice blocked Bob, When she loads recent slides, Then Bob’s deck is left out for her and stays for Carol', async () => {
  expect(await recent(alice)).toContain(bobTalk)
  await aliceBlocksBob()

  expect(await recent(alice)).not.toContain(bobTalk)
  expect(await recent(alice)).toEqual([...carolTalks, '/@alice/main'])
  expect(await recent(carol)).toContain(bobTalk)
  expect(await recent('')).toContain(bobTalk)
})

test('F32-AC3: Given Alice blocked Bob and follows him again, When she loads the new slides of the people she follows, Then Bob’s deck is not there', async () => {
  await db.insert(follows).values([
    { follower_user_id: OWNER_ID, followee_user_id: INVITED_ID, created_at: 1 },
    { follower_user_id: OWNER_ID, followee_user_id: CAROL_ID, created_at: 1 },
  ])
  expect(await following(alice)).toContain(bobTalk)
  await aliceBlocksBob()

  expect(await following(alice)).toEqual(carolTalks.slice(0, 4))
})

test.each(['cites', 'cited-by'] as const)(
  'F32-AC3, F32-AC6, F24-AC49: Given Alice blocked Bob, When she opens her deck, Then the %s list leaves Bob out of its cards and its overflow count',
  async (name) => {
    expect(await readerList(alice, name)).toEqual({
      cards: [bobTalk, ...carolTalks.slice(0, 3)],
      more: 2,
    })
    await aliceBlocksBob()

    expect(await readerList(alice, name)).toEqual({
      cards: carolTalks.slice(0, 4),
      more: 1,
    })
    expect((await readerList(carol, name)).cards).toContain(bobTalk)
  },
)

test('F32-AC7, F24-AC50: Given Alice blocked Bob, When she opens her cited list, Then Bob’s citation is not in its rows or its count', async () => {
  expect(await citedList(alice)).toEqual({
    rows: [bobTalk, ...carolTalks],
    count: 6,
  })
  await aliceBlocksBob()

  expect(await citedList(alice)).toEqual({ rows: carolTalks, count: 5 })
})

/** The cited count on the card of Alice's main deck in a JSON list. */
async function cardCount(path: string, cookie: string) {
  const response = await get(path, cookie)
  expect(response.status).toBe(200)
  const body = (await response.json()) as
    | { href: string; citedBy: number }[]
    | { following: { href: string; citedBy: number }[] }
    | null
  const cards = body === null ? [] : Array.isArray(body) ? body : body.following
  return cards.find((card) => card.href === '/@alice/main')?.citedBy ?? null
}

/** Everything a reader sees of the citations of Alice's main deck. */
const citationsSeenBy = async (cookie: string) => ({
  citedBy: await readerList(cookie, 'cited-by'),
  cited: await citedList(cookie),
  recent: await cardCount('/api/public/slides', cookie),
  home: await cardCount('/api/home', cookie),
})

test.each([
  ['Bob', () => bob],
  ['Carol', () => carol],
  ['a reader who is not signed in', () => ''],
])(
  'F32-AC7, F32-AC8: Given Bob’s deck cites Alice’s, When Alice blocks Bob, Then what %s sees of the citations of her deck — the list under it, her cited list and the card counts — stays the same',
  async (_, reader) => {
    // Both readers follow Alice, so her deck is on their top page too.
    await db.insert(follows).values([
      {
        follower_user_id: INVITED_ID,
        followee_user_id: OWNER_ID,
        created_at: 1,
      },
      { follower_user_id: CAROL_ID, followee_user_id: OWNER_ID, created_at: 1 },
    ])
    const before = await citationsSeenBy(reader())
    expect(before.citedBy.cards).toContain(bobTalk)
    expect(before.cited.rows).toContain(bobTalk)

    await aliceBlocksBob()
    // The block drops the follows; put the reader's back to compare.
    await db
      .insert(follows)
      .values([
        {
          follower_user_id: CAROL_ID,
          followee_user_id: OWNER_ID,
          created_at: 1,
        },
      ])
      .onConflictDoNothing()

    const after = await citationsSeenBy(reader())
    if (reader() === bob)
      expect({ ...after, home: before.home }).toEqual(before)
    else expect(after).toEqual(before)
  },
  30_000,
)

test('F32-AC7: Given Bob’s deck cites Alice’s, When Alice blocks Bob, Then her own view of the card counts leaves Bob’s citation out', async () => {
  const before = await cardCount('/api/public/slides', alice)
  await aliceBlocksBob()

  expect(await cardCount('/api/public/slides', alice)).toBe((before ?? 0) - 1)
})

test('F32-AC5, F20-AC13: Given Alice blocked Bob, When Bob’s deck citing hers is published, Then she gets no notification, while Carol’s citation reaches her', async () => {
  await aliceBlocksBob()

  await notifyCited(database, { deckId: 'bob-talk', now: 300 })
  await notifyCited(database, { deckId: 'carol-1', now: 300 })

  const shown = await listNotifications(database, OWNER_ID, 10)
  expect(shown.map((notification) => notification.actor.handle)).toEqual([
    'carol',
  ])
})

test('F32-AC5, F20-AC13: Given a notification of Bob’s citation, When Alice blocks Bob, Then it leaves her list and unread count, and comes back when she unblocks him', async () => {
  await notifyCited(database, { deckId: 'bob-talk', now: 300 })
  expect(await countUnread(database, OWNER_ID)).toBe(1)

  await aliceBlocksBob()
  expect(await listNotifications(database, OWNER_ID, 10)).toEqual([])
  expect(await countUnread(database, OWNER_ID)).toBe(0)

  await db.delete(blocks)
  expect(await countUnread(database, OWNER_ID)).toBe(1)
})

test('F32-AC9: Given Alice blocked Bob, When she opens his share URL and profile directly, Then both open and his profile lists his deck', async () => {
  await aliceBlocksBob()

  const deck = await get(bobTalk, alice)
  expect(deck.status).toBe(200)
  expect(await deck.text()).toContain('property="og:title" content="bob-talk"')
  const profile = await get('/@bob', alice)
  expect(profile.status).toBe(200)
  expect(await profile.text()).toContain(`href="${bobTalk}"`)
})

test('F32-AC10: Given Alice blocked Bob, When she unblocks him from the settings, Then his deck returns to her lists and his citation to her profile', async () => {
  await aliceBlocksBob()
  expect(await recent(alice)).not.toContain(bobTalk)

  const response = await server.fetch(
    new Request(new URL('/blocks/bob/release', TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: alice, Origin: TEST_ORIGIN },
      body: new URLSearchParams(),
    }),
    env,
  )
  expect(response.status).toBe(303)

  expect(await recent(alice)).toContain(bobTalk)
  expect((await readerList(alice, 'cited-by')).cards).toContain(bobTalk)
  expect((await citedList(alice)).rows).toContain(bobTalk)
})
