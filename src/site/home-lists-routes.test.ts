import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { accounts, decks, follows, mutes, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import type { HomeLists } from './home-lists'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const CAROL_ID = '999'
const env = {
  ...testEnv(platform.env),
  AUTHOR_GITHUB_IDS: [OWNER_ID, INVITED_ID, CAROL_ID].join(','),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
let alice = ''

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  alice = await signIn(env, 'alice')
  await db.insert(accounts).values([
    { user_id: INVITED_ID, handle: 'bob', created_at: 1 },
    { user_id: CAROL_ID, handle: 'carol', created_at: 1 },
  ])
})
afterAll(() => platform.dispose())

const ask = (cookie = alice) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/api/home`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )

const lists = async (cookie = alice) => {
  const response = await ask(cookie)
  expect(response.status).toBe(200)
  return (await response.json()) as HomeLists
}

const followAt = (follower: string, followee: string, at = 1) =>
  db.insert(follows).values({
    follower_user_id: follower,
    followee_user_id: followee,
    created_at: at,
  })

const names = (decksShown: readonly { name: string }[]) =>
  decksShown.map((deck) => deck.name)

test('F21-AC51: Given the visitor has slides of their own, public and not, When they ask for their lists, Then no list of their own slides comes', async () => {
  await seedPublic(database, 'public', 500, 'Public one')
  await seedDeck(database, 'draft')
  expect(await lists()).toEqual({ following: [] })
})

test('F21-AC16: Given the visitor follows Bob and not Carol, When Bob publishes, then stops, Then his slide shows among the new ones and then leaves, and Carol’s never shows', async () => {
  await followAt(OWNER_ID, INVITED_ID)
  await seedPublic(database, 'carols', 900, 'Carol’s', CAROL_ID)
  expect((await lists()).following).toEqual([])
  const id = await seedPublic(database, 'talk', 500, 'Bob’s talk', INVITED_ID)
  expect((await lists()).following).toEqual([
    {
      name: 'Bob’s talk',
      href: '/@bob/talk',
      handle: 'bob',
      authorHref: '/@bob',
      publishedAt: new Date(500_000).toISOString(),
      coverUrl: expect.stringMatching(/^\/covers\//),
    },
  ])
  await db
    .update(decks)
    .set({
      public_deployment_id: null,
      paused_at: 600,
      resume_deployment_id: id,
    })
    .where(eq(decks.id, 'talk'))
  expect((await lists()).following).toEqual([])
})

test('F21-AC16: Given six public slides of two followed people, When the visitor asks, Then the four most recently published come, newest first', async () => {
  await followAt(OWNER_ID, INVITED_ID)
  await followAt(OWNER_ID, CAROL_ID)
  for (const [index, owner] of [
    INVITED_ID,
    CAROL_ID,
    INVITED_ID,
    CAROL_ID,
    INVITED_ID,
    CAROL_ID,
  ].entries())
    await seedPublic(database, `d${index}`, 100 + index, `Talk ${index}`, owner)
  // The visitor's own public slide is not somebody they follow.
  await seedPublic(database, 'mine', 999, 'Mine')
  expect(names((await lists()).following)).toEqual([
    'Talk 5',
    'Talk 4',
    'Talk 3',
    'Talk 2',
  ])
})

test('F21-AC52: Given a visitor who follows nobody, or only people without public slides, When they ask, Then the list is empty, not missing', async () => {
  expect(await lists()).toEqual({ following: [] })
  await followAt(OWNER_ID, INVITED_ID)
  await seedDeck(database, 'draft', INVITED_ID)
  await seedDeployment(database, 'draft')
  expect(await lists()).toEqual({ following: [] })
})

test('F21-AC18: Given no session, When the lists are asked for, Then nothing is answered and no cache may keep it', async () => {
  await seedPublic(database, 'mine', 100, 'Mine')
  await followAt(OWNER_ID, INVITED_ID)
  await seedPublic(database, 'talk', 500, 'Bob’s talk', INVITED_ID)
  for (const cookie of ['', '__Host-slide_owner=forged.value']) {
    const response = await ask(cookie)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('null')
    expect(response.headers.get('Cache-Control')).toContain('private, no-store')
    expect(response.headers.get('Vary')).toContain('Cookie')
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex')
  }
})

test('F21-AC18: Given Alice follows Bob and Bob follows nobody, When each asks for their list, Then the answer is theirs alone and no cache may keep it', async () => {
  await followAt(OWNER_ID, INVITED_ID)
  await seedPublic(database, 'bobs', 200, 'Bob’s own', INVITED_ID)
  const bob = await signIn(env, 'bob', { id: INVITED_ID })
  const response = await ask()
  expect(response.headers.get('Cache-Control')).toContain('private, no-store')
  expect(response.headers.get('Vary')).toContain('Cookie')
  expect(names(((await response.json()) as HomeLists).following)).toEqual([
    'Bob’s own',
  ])
  expect(await lists(bob)).toEqual({ following: [] })
})

test('F21-AC21: Given the visitor follows three authors, one muted afterwards by a stray row, one suspended and one whose slide the operator hid, When they ask, Then none of those slides shows, as in the recent slides', async () => {
  const DAVE_ID = '555'
  await db
    .insert(accounts)
    .values({ user_id: DAVE_ID, handle: 'dave', created_at: 1 })
  for (const followee of [INVITED_ID, CAROL_ID, DAVE_ID])
    await followAt(OWNER_ID, followee)
  await seedPublic(database, 'bobs', 300, 'Bob’s', INVITED_ID)
  await seedPublic(database, 'carols', 200, 'Carol’s', CAROL_ID)
  await seedPublic(database, 'daves', 100, 'Dave’s', DAVE_ID)
  await seedPublic(database, 'daves-hidden', 150, 'Dave’s hidden', DAVE_ID)
  expect(names((await lists()).following)).toEqual([
    'Bob’s',
    'Carol’s',
    'Dave’s hidden',
    'Dave’s',
  ])
  // Muting removes the follow; a mute beside a follow that stayed still hides.
  await db.insert(mutes).values({
    muter_user_id: OWNER_ID,
    muted_user_id: INVITED_ID,
    created_at: 1,
  })
  await db.insert(suspensions).values({
    user_id: CAROL_ID,
    reason: 'test',
    suspended_at: 1,
    suspended_by: 'operator',
  })
  await db
    .update(decks)
    .set({ hidden_at: 1, hidden_reason: 'test', hidden_by: 'operator' })
    .where(eq(decks.id, 'daves-hidden'))
  expect(names((await lists()).following)).toEqual(['Dave’s'])
  // What the recent slides show this visitor follows the same rules.
  const recent = (await (
    await server.fetch(
      new Request(`${TEST_ORIGIN}/api/public/slides`, {
        headers: { Cookie: alice },
      }),
      env,
    )
  ).json()) as { name: string }[]
  expect(names(recent)).toEqual(['Dave’s'])
})
