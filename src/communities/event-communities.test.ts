import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { blocks, communities, events } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  seedDeck,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { listEventCommunities } from './event-communities-store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from './test-communities'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let owner = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetCommunities(db)
  owner = await signIn(env)
  await seedPublic(db, 'talk', 100, 'Talk')
  await seedTalkLink(db, {
    deckId: 'talk',
    url: 'https://kanagawapm.connpass.com/event/410635/',
    title: 'Kanagawa.pm #3',
  })
})
afterAll(() => platform.dispose())

const eventId = async () =>
  (await orm
    .select()
    .from(events)
    .where(eq(events.key, 'https://connpass.com/event/410635'))
    .get())!.id
// Where the event's page is (F45-AC9).
const EVENT_PAGE = '/link/connpass.com/event/410635'
const flat = async (path: string, cookie = '') =>
  (
    await (
      await server.fetch(
        new Request(`${TEST_ORIGIN}${path}`, {
          headers: cookie ? { Cookie: cookie } : {},
        }),
        env,
      )
    ).text()
  ).replace(/\s+/g, ' ')

test('F45-AC17: Given an event in a community, When its page opens, Then it shows the community, linked, and the community’s pattern in its color', async () => {
  await seedCommunity(db, {
    id: 77,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
  })
  await orm.update(communities).set({ color: 'green' })
  const body = await flat(EVENT_PAGE)
  expect(body).toContain('<a href="/@kanagawapm">Kanagawa.pm</a>')
  expect(body).toContain('aria-label="Kanagawa.pm のカバー画像"')
  expect(body).toContain('var(--community-green')
  expect(body).not.toContain('このグループのコミュニティはまだありません')
})

test('F45-AC17: Given an event in a community, When its page opens, Then its head starts with the community’s logo, its initial or the uploaded one, before the linked name', async () => {
  await seedCommunity(db, {
    id: 77,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
  })
  const head = (body: string) =>
    /<p class="event-community">(.*?)<\/p>/s.exec(body)?.[1] ?? ''
  const page = await flat(EVENT_PAGE)
  // The logo is drawn 28px square: its styles come with the page.
  expect(page).toMatch(/\.community-logo-28 \{\s*width: 28px;\s*height: 28px;/)
  const initial = head(page)
  expect(initial).toMatch(
    /class="community-logo community-logo-28"[^>]*aria-hidden="true"\s*>K<\/span\s*>\s*<a href="\/@kanagawapm">Kanagawa\.pm<\/a>/,
  )
  await orm.update(communities).set({ logo_at: 4321 })
  const uploaded = head(await flat(EVENT_PAGE))
  expect(uploaded).toContain('src="/communities/77/logo?v=4321"')
  expect(uploaded).toContain('alt=""')
})

test('F45-AC17: Given a community with an uploaded cover, When its event page opens, Then that cover shows', async () => {
  await seedCommunity(db, {
    id: 77,
    handle: 'kanagawapm',
    links: ['https://kanagawapm.connpass.com/'],
  })
  await orm.update(communities).set({ cover_at: 1234 })
  const body = await flat(EVENT_PAGE)
  expect(body).toContain('src="/communities/77/cover?v=1234"')
  expect(body).not.toContain('class="cover-pattern"')
})

test('F45-AC27: Given an event in no community, When its page opens, Then the way to make one stays and no community shows', async () => {
  const body = await flat(EVENT_PAGE)
  expect(body).toContain('このグループのコミュニティはまだありません')
  expect(body).toContain(
    '/communities/new?link=https%3A%2F%2Fkanagawapm.connpass.com%2F',
  )
})

test('F29-AC29: Given a deck’s event in a community, When its editing page opens, Then the row of the link says it is listed on the community’s page', async () => {
  await seedCommunity(db, {
    id: 77,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
  })
  const body = await flat('/my/slides/talk', owner)
  expect(body).toContain('Kanagawa.pm のページに並びます。')
})

test('Given an event in two communities, When it is shown, Then the one whose link was added first is used', async () => {
  // A deck keeps one link to an event (F27-AC44): the other group is on another.
  await seedPublic(db, 'other', 200, 'Other')
  await seedTalkLink(db, {
    deckId: 'other',
    url: 'https://yokohama.connpass.com/event/410635/',
  })
  await seedCommunity(db, {
    id: 2,
    handle: 'yokohama',
    links: ['https://yokohama.connpass.com/'],
    creator: 'y',
  })
  await seedCommunity(db, {
    id: 1,
    handle: 'kanagawapm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
  const id = await eventId()
  expect((await listEventCommunities(db, [id])).get(id)?.handle).toBe(
    'yokohama',
  )
})

test('Given no event or an event in none, When communities are asked for, Then none come', async () => {
  expect(await listEventCommunities(db, [])).toEqual(new Map())
  expect(await listEventCommunities(db, [await eventId()])).toEqual(new Map())
})

test('F45-AC15: F32-AC22: Given a reader who blocked the author of a talk, When they open the event page, Then the talk is in neither the list nor the count; others still see it', async () => {
  await signIn(env, 'bob', { id: '2' })
  await seedPublic(db, 'reply', 200, 'Bob talk', '2')
  await seedTalkLink(db, {
    deckId: 'reply',
    url: 'https://kanagawapm.connpass.com/event/410635/',
    owner: '2',
  })
  await orm
    .insert(blocks)
    .values({ blocker_user_id: OWNER_ID, blocked_user_id: '2', created_at: 1 })
  const path = EVENT_PAGE
  const mine = await flat(path, owner)
  expect(mine).not.toContain('Bob talk')
  expect(mine).toContain('<span class="event-talks-count">1 本</span>')
  const theirs = await flat(path)
  expect(theirs).toContain('Bob talk')
  expect(theirs).toContain('<span class="event-talks-count">2 本</span>')
})

test('Given the group’s address only on a private deck and a public talk without a group, When the event page opens, Then no community shows', async () => {
  await seedCommunity(db, {
    id: 9,
    handle: 'hono',
    name: 'Hono',
    links: ['https://hono.connpass.com/'],
  })
  await seedDeck(db, 'secret')
  await seedTalkLink(db, {
    deckId: 'secret',
    url: 'https://hono.connpass.com/event/5/',
  })
  await seedPublic(db, 'open', 300, 'Open talk')
  await seedTalkLink(db, {
    deckId: 'open',
    url: 'https://connpass.com/event/5/',
  })
  const id = (await orm
    .select()
    .from(events)
    .where(eq(events.key, 'https://connpass.com/event/5'))
    .get())!.id
  const body = await flat('/link/connpass.com/event/5')
  expect(body).toContain('Open talk')
  expect(body).not.toContain('href="/@hono"')
  expect((await listEventCommunities(db, [id])).size).toBe(0)
})
