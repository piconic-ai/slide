import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from './routes'
import { events, relatedLinkEvents } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from '../communities/test-communities'
import { japaneseOutside } from '../site/test-japanese'

// The pages the third scope added, opened through the whole app: each is
// answered by its own route, not by an earlier one or by a handle's page,
// and each reads in both languages.

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = testEnv(platform.env) as unknown as Env
const COMMUNITY_ID = 7
let alice = ''
let eventId = 0

beforeAll(async () => {
  await applyMigrations(db)
  await resetCommunities(db)
  alice = await signIn(env, 'alice')
  await signIn(env, 'bob', { id: INVITED_ID })
  await seedPublic(db, 'talk', 2, 'Kanagawa.pm talk', OWNER_ID)
  // A person's slides may be named "edit": only a community's page takes it.
  await seedPublic(db, 'edit-deck', 1, 'Slides named edit', OWNER_ID, 'edit')
  await seedPublic(db, 'bob-talk', 3, 'Bob talk', INVITED_ID)
  await seedTalkLink(db, {
    deckId: 'talk',
    owner: OWNER_ID,
    url: 'https://kanagawapm.connpass.com/event/410635/',
    title: 'Kanagawa.pm meetup',
  })
  await seedCommunity(db, {
    id: COMMUNITY_ID,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
  // The owner follows it as its maker (F31-AC17).
  const orm = drizzle(db)
  const [row] = await orm
    .select({ id: events.id })
    .from(events)
    .innerJoin(relatedLinkEvents, eq(relatedLinkEvents.event_id, events.id))
  if (!row) throw new Error('no event')
  eventId = row.id
})
afterAll(() => platform.dispose())

const open = (path: string, cookie = alice) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )
const flat = async (response: Response) =>
  (await response.text()).replace(/\s+/g, ' ')

test('F30-AC10: Given the page that makes a community, When a signed-in person opens /communities/new, Then its form answers, not a handle or a 404', async () => {
  const response = await open('/communities/new')
  expect(response.status).toBe(200)
  expect(await flat(response)).toContain('action="/communities/new"')
})

test('F30-AC47: Given the list of every community, When /communities is opened signed out, Then its own page answers with the community, not a handle or a 404', async () => {
  const response = await open('/communities', '')
  expect(response.status).toBe(200)
  expect(await flat(response)).toContain('href="/@kanagawapm"')
})

test('F29-AC5: Given an event with a public talk, When /events/:id is opened, Then the event page answers with the talk', async () => {
  const response = await open(`/events/${eventId}`)
  expect(response.status).toBe(200)
  const body = await flat(response)
  expect(body).toContain('Kanagawa.pm meetup')
  expect(body).toContain('/@alice/talk')
})

test('F32-AC14: Given another person, When /blocks/new is opened for them, Then the block confirmation answers', async () => {
  const response = await open(
    `/blocks/new?${new URLSearchParams({ handle: 'bob', slide: '/@bob/bob-talk' })}`,
  )
  expect(response.status).toBe(200)
  expect(await flat(response)).toContain('action="/blocks"')
})

test('F30-AC3: Given a community and a person whose slides are named "edit", When each /@handle/edit is opened, Then the community gets its edit page and the person keeps the slides', async () => {
  const community = await open('/@kanagawapm/edit')
  expect(community.status).toBe(200)
  expect(await flat(community)).toContain(
    `action="/communities/${COMMUNITY_ID}/edit"`,
  )
  const person = await open('/@alice/edit', '')
  expect(person.status).toBe(200)
  const body = await flat(person)
  expect(body).toContain('Slides named edit')
  expect(body).not.toContain(`/communities/${COMMUNITY_ID}/edit`)
})

test('F31-AC8: Given a person who follows a community, When /@handle/communities is opened, Then the profile tab lists it, not slides named so', async () => {
  const response = await open('/@alice/communities', '')
  expect(response.status).toBe(200)
  const body = await flat(response)
  expect(body).toContain('href="/@kanagawapm"')
  expect(body).toContain('Kanagawa.pm')
})

test('F33-AC18: Given the page the feed bot points to, When /help/bot is opened, Then the help about the bot answers, not the help page or a 404', async () => {
  const response = await open('/help/bot', '')
  expect(response.status).toBe(200)
  const body = await flat(response)
  expect(body).toContain('slide.community-bot/1.0')
  expect(body).toContain('api.lu.ma')
})

const screens = () => [
  '/communities/new',
  '/communities',
  `/events/${eventId}`,
  `/blocks/new?${new URLSearchParams({ handle: 'bob', slide: '/@bob/bob-talk' })}`,
  '/@kanagawapm',
  '/@kanagawapm/slides',
  '/@kanagawapm/followers',
  '/@kanagawapm/edit',
  '/@alice/communities',
  '/@alice/talk',
  '/communities/following',
  '/my/communities',
  '/settings',
  '/help/bot',
]

const withLang = (path: string, lang: string) =>
  `${path}${path.includes('?') ? '&' : '?'}lang=${lang}`

test('D-12: Given each screen the third scope added or changed, When it opens in English, Then no Japanese is left but the switcher label', async () => {
  for (const path of screens()) {
    const response = await open(withLang(path, 'en'))
    expect(response.status, path).toBe(200)
    expect(japaneseOutside(await response.text()), path).toEqual([])
  }
})

test('D-12: Given each screen the third scope added or changed, When it opens in Japanese, Then it says it is Japanese and carries Japanese text', async () => {
  for (const path of screens()) {
    const response = await open(withLang(path, 'ja'))
    expect(response.status, path).toBe(200)
    const html = await response.text()
    expect(html, path).toContain('<html lang="ja">')
    expect(html, path).toMatch(/[぀-ヿ一-鿿]/)
  }
})
