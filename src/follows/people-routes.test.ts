import { eq, like } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import {
  accounts,
  decks,
  deployments,
  follows,
  mutes,
  suspensions,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { PROFILE_DECKS_SHOWN } from '../share/list-pages'
import { PEOPLE_PER_PAGE } from './people'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const CAROL_ID = '999'
const env = {
  ...testEnv(platform.env),
  AUTHOR_GITHUB_IDS: [OWNER_ID, INVITED_ID, CAROL_ID].join(','),
} as unknown as Env
let alice = ''
let carol = ''

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  await signIn(env, 'bob', { id: INVITED_ID })
  carol = await signIn(env, 'carol', { id: CAROL_ID })
  await seedPublic(database, 'talk', 2, 'Bob’s talk', INVITED_ID)
  await seedPublic(database, 'keynote', 1, 'Alice’s keynote', OWNER_ID)
  await seedPublic(database, 'second', 3, 'Alice’s second', OWNER_ID)
})
beforeEach(async () => {
  await db.batch([
    db.delete(follows),
    db.delete(mutes),
    db.delete(suspensions),
    db.delete(accounts).where(eq(accounts.created_at, 77)),
    // Decks and deployments reference each other, so the pointer goes first.
    db
      .update(decks)
      .set({ public_deployment_id: null })
      .where(eq(decks.id, 'squatter')),
    db.delete(deployments).where(eq(deployments.deck_id, 'squatter')),
    db.delete(decks).where(eq(decks.id, 'squatter')),
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

const followAt = (follower: string, followee: string, at: number) =>
  db.insert(follows).values({
    follower_user_id: follower,
    followee_user_id: followee,
    created_at: at,
  })

/** The profiles a page's rows lead to, in order. */
const rows = (page: string) =>
  [...page.matchAll(/<a class="person-name" href="([^"]+)"/g)].map(
    (match) => match[1],
  )

/** Each tab's name, count, and whether it is the open one. */
const tabs = (page: string) =>
  [
    ...page.matchAll(
      /<a\s+href="([^"]+)"\s*(aria-current="page")?\s*>([^<]+?) <span class="count">(\d+)<\/span><\/a\s*>/g,
    ),
  ].map((match) => ({
    href: match[1],
    name: match[3],
    count: Number(match[4]),
    current: match[2] !== undefined,
  }))

test('F21-AC8: Given Alice follows Bob and Carol follows Alice, When a visitor who is not signed in opens Alice’s lists, Then they see who she follows and who follows her', async () => {
  await followAt(OWNER_ID, INVITED_ID, 10)
  await followAt(CAROL_ID, OWNER_ID, 20)
  const following = await get('/@alice/following')
  expect(following.status).toBe(200)
  const page = await following.text()
  expect(rows(page)).toEqual(['/@bob'])
  expect(page).toContain('<title>フォロー中 - @alice - Slide</title>')
  expect(page).not.toContain('class="deck-card"')
  // The page is made of what a reader may see: nothing keeps it.
  expect(following.headers.get('Cache-Control')).toContain('no-store')
  const followers = await get('/@alice/followers')
  expect(followers.status).toBe(200)
  expect(rows(await followers.text())).toEqual(['/@carol'])
})

test('F21-AC9: Given an author with slides, follows and followers, When their profile and lists are opened, Then every tab carries its count and the open one is marked', async () => {
  await followAt(OWNER_ID, INVITED_ID, 10)
  await followAt(INVITED_ID, OWNER_ID, 20)
  await followAt(CAROL_ID, OWNER_ID, 30)
  const expected = (current: string) => [
    { href: '/@alice', name: 'スライド', count: 2, current: current === '' },
    {
      href: '/@alice/following',
      name: 'フォロー中',
      count: 1,
      current: current === 'following',
    },
    {
      href: '/@alice/followers',
      name: 'フォロワー',
      count: 2,
      current: current === 'followers',
    },
  ]
  for (const current of ['', 'following', 'followers']) {
    const page = await (
      await get(current ? `/@alice/${current}` : '/@alice')
    ).text()
    expect(tabs(page)).toEqual(expected(current))
  }
  // An author nobody follows shows zeros, not a missing tab.
  expect(
    tabs(await (await get('/@carol')).text()).map(({ count }) => count),
  ).toEqual([0, 1, 0])
})

test('F21-AC10: Given a followed person is suspended, When anyone opens the list, Then the person is neither listed nor counted', async () => {
  await followAt(OWNER_ID, INVITED_ID, 10)
  await followAt(OWNER_ID, CAROL_ID, 20)
  await db.insert(suspensions).values({
    user_id: INVITED_ID,
    reason: 'test',
    suspended_at: 1,
    suspended_by: 'operator',
  })
  const page = await (await get('/@alice/following')).text()
  expect(rows(page)).toEqual(['/@carol'])
  expect(tabs(page)[1]?.count).toBe(1)
  expect(page).not.toContain('@bob')
})

test('F21-AC11: Given Carol muted Bob, When Carol opens Alice’s following, Then Bob is missing from her list and her count, and a visitor still sees him', async () => {
  await followAt(OWNER_ID, INVITED_ID, 10)
  await db.insert(mutes).values({
    muter_user_id: CAROL_ID,
    muted_user_id: INVITED_ID,
    created_at: 1,
  })
  const mine = await (await get('/@alice/following', carol)).text()
  expect(rows(mine)).toEqual([])
  expect(tabs(mine)[1]?.count).toBe(0)
  expect(tabs(await (await get('/@alice', carol)).text())[1]?.count).toBe(0)
  const theirs = await (await get('/@alice/following')).text()
  expect(rows(theirs)).toEqual(['/@bob'])
  expect(tabs(theirs)[1]?.count).toBe(1)
})

test.each(['following', 'followers'])(
  'F21-AC14: Given a handle nobody holds and a suspended author, When their %s list is opened, Then both answer the profile’s 404',
  async (list) => {
    await followAt(OWNER_ID, INVITED_ID, 10)
    await followAt(INVITED_ID, OWNER_ID, 10)
    const missing = await get(`/@nobody/${list}`)
    const profile = await get('/@nobody')
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe(
      (await profile.text()).replaceAll('/@nobody', `/@nobody/${list}`),
    )
    await db.insert(suspensions).values({
      user_id: INVITED_ID,
      reason: 'test',
      suspended_at: 1,
      suspended_by: 'operator',
    })
    const suspended = await get(`/@bob/${list}`)
    expect(suspended.status).toBe(404)
    const page = await suspended.text()
    expect(page).toContain('このページは見つかりません')
    expect(page).not.toContain('alice')
    expect(suspended.headers.get('X-Robots-Tag')).toBe('noindex')
  },
)

test('F21-AC19: Given 51 followers, When the list is opened, Then the first page shows the newest 50 and leads to a second page with the last one', async () => {
  const ids = Array.from({ length: PEOPLE_PER_PAGE + 1 }, (_, index) =>
    String(5000 + index),
  )
  for (let start = 0; start < ids.length; start += 25) {
    const some = ids.slice(start, start + 25)
    await db.batch([
      db
        .insert(accounts)
        .values(
          some.map((id) => ({ user_id: id, handle: `p${id}`, created_at: 77 })),
        ),
      db.insert(follows).values(
        some.map((id, index) => ({
          follower_user_id: id,
          followee_user_id: OWNER_ID,
          created_at: 1000 + start + index,
        })),
      ),
    ])
  }
  const first = await (await get('/@alice/followers')).text()
  expect(rows(first)).toHaveLength(PEOPLE_PER_PAGE)
  expect(rows(first)[0]).toBe('/@p5050')
  expect(tabs(first)[2]?.count).toBe(PEOPLE_PER_PAGE + 1)
  expect(first).toMatch(
    /<a rel="next" href="\/@alice\/followers\?page=2"\s*>次の 50 人<\/a\s*>/,
  )
  expect(first).not.toContain('rel="prev"')
  const second = await (await get('/@alice/followers?page=2')).text()
  expect(rows(second)).toEqual(['/@p5000'])
  expect(second).toMatch(/<a rel="prev" href="\/@alice\/followers"\s*>/)
  expect(second).not.toContain('rel="next"')
  // A page past the end has nobody, and leads back.
  const past = await get('/@alice/followers?page=7')
  expect(past.status).toBe(200)
  const pastPage = await past.text()
  expect(rows(pastPage)).toEqual([])
  expect(pastPage).toContain('このページには、だれもいません。')
  expect(pastPage).toMatch(/rel="prev" href="\/@alice\/followers\?page=2"/)
})

test.each(['0', '-1', 'abc', '1.5', ''])(
  'F21-AC19: Given ?page=%j, When the list is opened, Then it is not a page',
  async (page) => {
    const response = await get(`/@alice/followers?page=${page}`)
    expect(response.status).toBe(404)
  },
)

test('F21-AC8: Given nobody follows the author, When their followers are opened, Then the page says so and shows no way to other pages', async () => {
  const page = await (await get('/@carol/followers')).text()
  expect(rows(page)).toEqual([])
  expect(page).toContain('フォロワーはまだいません。')
  expect(page).not.toContain('class="people-pages"')
  expect(await (await get('/@carol/following')).text()).toContain(
    'まだだれもフォローしていません。',
  )
})

test.each(['following', 'followers'])(
  'F21-AC20: Given the author somehow has a public slide named %s, When the path of that name under their handle is opened, Then the list opens, not the slide',
  async (list) => {
    // The names are reserved, so only a row written past the rule holds one.
    await seedPublic(database, 'squatter', 5, 'Squatter', CAROL_ID, list)
    await followAt(OWNER_ID, CAROL_ID, 10)
    await followAt(CAROL_ID, INVITED_ID, 10)
    const response = await get(`/@carol/${list}`)
    expect(response.status).toBe(200)
    const page = await response.text()
    expect(rows(page)).toEqual([list === 'following' ? '/@bob' : '/@alice'])
    expect(page).not.toContain('id="deck"')
    expect(page).not.toContain('Squatter - @carol')
    // A slide's own frame asks for it too, and still gets no slide.
    const framed = await server.fetch(
      new Request(new URL(`/@carol/${list}`, TEST_ORIGIN), {
        headers: { 'Sec-Fetch-Dest': 'iframe' },
      }),
      env,
    )
    expect(rows(await framed.text())).toHaveLength(1)
    // No page of a slide hides under the name either.
    expect((await get(`/@carol/${list}/2`)).status).toBe(404)
  },
)

test.each([
  ['/@Alice/Following', '/@alice/following'],
  ['/@alice/followers/', '/@alice/followers'],
  ['/%40alice/FOLLOWERS', '/@alice/followers'],
])(
  'F21-AC20: Given the spelling %s, When opened, Then it redirects to the canonical list',
  async (path, canonical) => {
    const response = await get(path)
    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe(canonical)
  },
)

test('F21-AC8: Given the reader chose English, When a list is opened, Then its tabs, title and words are in English', async () => {
  await followAt(OWNER_ID, INVITED_ID, 10)
  const page = await (await get('/@alice/following?lang=en')).text()
  expect(page).toContain('<title>Following - @alice - Slide</title>')
  expect(tabs(page).map(({ name }) => name)).toEqual([
    'Slides',
    'Following',
    'Followers',
  ])
  expect(await (await get('/@alice/followers?lang=en')).text()).toContain(
    'No followers yet.',
  )
})

test('F21-AC8: Given the signed-in author, When she opens her own lists, Then they open like anyone’s', async () => {
  await followAt(OWNER_ID, INVITED_ID, 10)
  const response = await get('/@alice/following', alice)
  expect(response.status).toBe(200)
  expect(rows(await response.text())).toEqual(['/@bob'])
})

test('F21-AC9: Given an author with one more public slide than a profile lists, When their profile and a list are opened, Then the tab counts every slide, not only those listed', async () => {
  const total = PROFILE_DECKS_SHOWN + 1
  for (let index = 0; index < total; index++)
    await seedPublic(database, `many-${index}`, 10 + index, null, CAROL_ID)
  try {
    const profile = await (await get('/@carol')).text()
    expect(tabs(profile)[0]?.count).toBe(total)
    expect(profile.match(/class="deck-card"/g)).toHaveLength(
      PROFILE_DECKS_SHOWN,
    )
    expect(tabs(await (await get('/@carol/followers')).text())[0]?.count).toBe(
      total,
    )
  } finally {
    await db
      .update(decks)
      .set({ public_deployment_id: null })
      .where(like(decks.id, 'many-%'))
    await db.delete(deployments).where(like(deployments.deck_id, 'many-%'))
    await db.delete(decks).where(like(decks.id, 'many-%'))
  }
}, 60_000)
