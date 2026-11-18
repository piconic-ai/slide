import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import {
  accounts,
  citations,
  communities,
  events,
  eventTalks,
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

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const CAROL_ID = '999'
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  AUTHOR_GITHUB_IDS: [OWNER_ID, INVITED_ID, CAROL_ID].join(','),
} as unknown as Env
let alice = ''
let carol = ''

const get = (path: string, cookie?: string) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )

// All three recommendation lists contain Bob first, followed by Carol's
// five talks. With four slots, muting Bob must promote a talk and change
// the overflow count in every list.
async function seedRecommendations() {
  const main = await seedPublic(database, 'main', 1, 'Main', OWNER_ID)
  await db.insert(communities).values({
    id: 'group',
    name: 'Group',
    url: 'https://group.example/',
  })
  await db.insert(events).values({
    id: 'event',
    community_id: 'group',
    name: 'Event',
    url: 'https://group.example/event',
    held_on: '2026-11-01',
  })
  await db.insert(eventTalks).values({
    event_id: 'event',
    position: 0,
    deck_id: 'main',
  })
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
    await db.insert(eventTalks).values({
      event_id: 'event',
      position: index + 1,
      deck_id: slug,
    })
  }
}

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  carol = await signIn(env, 'carol', { id: CAROL_ID })
  expect(alice).not.toBe('')
  expect(carol).not.toBe('')
  await db.insert(accounts).values({
    user_id: INVITED_ID,
    handle: 'bob',
    created_at: 1,
  })
  await seedRecommendations()
  await db.insert(mutes).values({
    muter_user_id: OWNER_ID,
    muted_user_id: INVITED_ID,
    created_at: 200,
  })
})
afterAll(() => platform.dispose())

async function expectRecent(cookie: string, links: string[]) {
  const response = await get('/api/public/slides', cookie)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe(
    cookie ? 'private, no-store' : 'public, max-age=60',
  )
  expect(response.headers.get('Vary')).toBe('Cookie')
  expect(await response.json()).toEqual(
    links.map((href) => expect.objectContaining({ href })),
  )
}

async function expectRecommendations(
  cookie: string,
  links: string[],
  more: number,
) {
  const response = await get('/@alice/main', cookie)
  expect(response.status).toBe(200)
  const page = await response.text()
  const sections = [
    ...page.matchAll(
      /<section class="cites(?: talks)?">([\s\S]*?)<\/section>/g,
    ),
  ]
  expect(sections).toHaveLength(3)
  for (const [, section] of sections) {
    const shown = [...section.matchAll(/href="(\/@[^"]+)"/g)]
    expect(shown.map((match) => match[1])).toEqual(links)
    expect(section).toContain(`ほか ${more} 件`)
  }
}

const bobTalk = '/@bob/bob-talk'
const carolTalks = [1, 2, 3, 4, 5].map((n) => `/@carol/carol-${n}`)

test('F19-AC2: Given Alice muted Bob, When she loads recent decks and opens her deck, Then only visible decks fill the recommendations and their overflow counts', async () => {
  await expectRecent(alice, [...carolTalks, '/@alice/main'])
  await expectRecommendations(alice, carolTalks.slice(0, 4), 1)
})

test('F19-AC3: Given Alice muted Bob, When she opens his share URL and profile directly, Then his deck opens and his profile lists it', async () => {
  const deck = await get(bobTalk, alice)
  expect(deck.status).toBe(200)
  expect(await deck.text()).toContain('property="og:title" content="bob-talk"')
  const profile = await get('/@bob', alice)
  expect(profile.status).toBe(200)
  expect(await profile.text()).toContain(`class="card-title" href="${bobTalk}"`)
})

test.each(['Carol', 'an anonymous reader'])(
  'F19-AC4: Given Alice muted Bob, When %s loads the same lists, Then Bob is still shown and counted and the recent response varies by cookie',
  async (reader) => {
    const cookie = reader === 'Carol' ? carol : ''
    await expectRecent(cookie, [bobTalk, ...carolTalks, '/@alice/main'])
    await expectRecommendations(cookie, [bobTalk, ...carolTalks.slice(0, 3)], 2)
  },
)

test('F19-AC2: Given Alice muted an author who cites her deck, When she views her own citation records, Then the citing deck is still listed', async () => {
  const response = await get('/slides/main/reactions', alice)
  expect(response.status).toBe(200)
  expect(await response.text()).toContain(`href="${bobTalk}"`)
})

test('F19-AC2: Given Alice is suspended after muting Bob, When she requests recent decks and opens a public deck, Then both remain readable and the recent list respects her mute', async () => {
  await db.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'suspended',
    suspended_at: 300,
    suspended_by: 'operator',
  })
  try {
    await expectRecent(alice, carolTalks)
    expect((await get(bobTalk, alice)).status).toBe(200)
  } finally {
    await db.delete(suspensions).where(eq(suspensions.user_id, OWNER_ID))
  }
})

test('F19-AC4: Given a deck page shaped by one reader’s mutes, When a signed-in reader and an anonymous reader open it, Then only the signed-in reader’s page is marked private', async () => {
  const signedIn = await get('/@alice/main', alice)
  // The site adds no-transform to every page.
  expect(signedIn.headers.get('Cache-Control')).toMatch(/^private, no-cache\b/)
  const anonymous = await get('/@alice/main')
  expect(anonymous.headers.get('Cache-Control')).toMatch(/^no-cache\b/)
})
