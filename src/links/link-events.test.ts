import { asc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { keepArticle } from '../articles/store'
import { markAccountDeleted, markDeckDeleted } from '../decks/deletion-store'
import { events, relatedLinkEvents } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { eventRefOf } from '../events/event-url'
import {
  OWNER_ID,
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { MAX_LINKS } from './link'
import {
  addLink,
  listEventLinkHosts,
  listLinks,
  removeLink,
  setLinkKind,
} from './store'

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
  await resetTables(db)
  owner = await signIn(env)
})
afterAll(() => platform.dispose())

const add = (
  fields: Partial<Record<'kind' | 'url' | 'title', string>>,
  deck = 'talk',
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/my/slides/${deck}/links`, {
      method: 'POST',
      headers: {
        Cookie: owner,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )
const allEvents = () => orm.select().from(events).orderBy(asc(events.id)).all()
const ties = () => orm.select().from(relatedLinkEvents).all()
const kindsOf = async (deck = 'talk') =>
  (await listLinks(db, deck)).map((link) => link.kind)
const eventOf = (url: string) => {
  const event = eventRefOf(url)
  if (!event) throw new Error(url)
  return event
}

test.each([
  ['F29-AC1', 'https://kanagawapm.connpass.com/event/410635/'],
  ['F29-AC1', 'https://connpass.com/event/410635/'],
  ['F29-AC2', 'https://rubykaigi.doorkeeper.jp/events/12345'],
  ['F29-AC3', 'https://luma.com/abcd1234'],
  ['F29-AC3', 'https://lu.ma/abcd1234'],
])(
  '%s: Given the event address %s, When the author adds it without choosing a kind, Then it is an event with its event',
  async (_, url) => {
    await seedPublic(db, 'talk', 100, 'Talk')
    expect((await add({ url })).status).toBe(303)
    const [link] = await listLinks(db, 'talk')
    expect(link?.kind).toBe('event')
    const [event] = await allEvents()
    expect(link).toMatchObject({ eventId: event?.id })
    expect(event?.key).toBe(eventOf(url).key)
  },
)

test('F29-AC3: Given a Luma site address, When the author adds it without choosing a kind, Then it is not an event', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ url: 'https://luma.com/discover' })
  expect(await kindsOf()).toEqual(['other'])
  expect(await allEvents()).toEqual([])
})

test('F27-AC87: Given the four kinds, When the author adds a link of each by choosing it, Then each is saved with the chosen kind', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  for (const kind of ['video', 'article', 'event', 'other'])
    expect(
      (await add({ kind, url: `https://example.com/${kind}` })).status,
    ).toBe(303)
  expect(await kindsOf()).toEqual(['video', 'article', 'event', 'other'])
})

test('F29-AC28: Given an event address, When the author chooses another kind for it, Then it is that kind and in no event', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({
    kind: 'article',
    url: 'https://kanagawapm.connpass.com/event/1/',
  })
  expect(await kindsOf()).toEqual(['article'])
  expect(await allEvents()).toEqual([])
  expect(await ties()).toEqual([])
})

test('F29-AC28: Given an address of no known event shape, When the author chooses the kind event, Then it has the event of its host and path', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ kind: 'event', url: 'https://peatix.com/event/123/view?x=1' })
  expect(await kindsOf()).toEqual(['event'])
  expect(await allEvents()).toMatchObject([
    {
      key: 'https://peatix.com/event/123/view',
      service: 'web',
      ref: 'peatix.com/event/123/view',
    },
  ])
})

test('F29-AC6: Given one event written in several ways on several decks, When each is added, Then there is one event and every link is in it', async () => {
  const urls = [
    'https://luma.com/abcd1234',
    'https://lu.ma/abcd1234/',
    'https://LU.MA/abcd1234?tk=1',
    'https://luma.com/abcd1234#about',
  ]
  for (const [index, url] of urls.entries()) {
    await seedPublic(db, `t${index}`, 100 + index, 'Talk')
    await add({ url }, `t${index}`)
  }
  const all = await allEvents()
  expect(all).toHaveLength(1)
  expect((await ties()).map((tie) => tie.event_id)).toEqual(
    urls.map(() => all[0]?.id),
  )
})

test('F29-AC7: Given connpass addresses of one number under two groups and none, When they are added to three decks, Then they are one event', async () => {
  // One deck keeps one link to an event (F27-AC44), so each is on its own.
  await seedPublic(db, 'a', 100, 'A')
  await seedPublic(db, 'b', 200, 'B')
  await seedPublic(db, 'c', 300, 'C')
  await add({ url: 'https://kanagawapm.connpass.com/event/410635/' }, 'a')
  await add({ url: 'https://yokohamapm.connpass.com/event/410635/' }, 'b')
  await add({ url: 'https://connpass.com/event/410635/' }, 'c')
  expect(await allEvents()).toMatchObject([
    {
      key: 'https://connpass.com/event/410635',
      service: 'connpass',
      ref: '410635',
      host: 'connpass.com',
      url: 'https://connpass.com/event/410635/',
    },
  ])
  const [event] = await allEvents()
  expect(await listEventLinkHosts(db, event!.id)).toEqual(
    new Set([
      'kanagawapm.connpass.com',
      'yokohamapm.connpass.com',
      'connpass.com',
    ]),
  )
})

test('F29-AC7: Given a wrong group saved first for an event, When the right group is added after, Then the event leads to the page without a group and keeps both groups on the links, not on the event', async () => {
  await seedPublic(db, 'a', 100, 'A')
  await seedPublic(db, 'b', 200, 'B')
  await add({ url: 'https://evil.connpass.com/event/410635/' }, 'a')
  await add({ url: 'https://kanagawapm.connpass.com/event/410635/' }, 'b')
  const [event, ...rest] = await allEvents()
  expect(rest).toEqual([])
  expect(event).toMatchObject({
    host: 'connpass.com',
    url: 'https://connpass.com/event/410635/',
  })
  expect((await ties()).map((tie) => tie.host).sort()).toEqual([
    'evil.connpass.com',
    'kanagawapm.connpass.com',
  ])
  expect(await listEventLinkHosts(db, event!.id)).toEqual(
    new Set(['evil.connpass.com', 'kanagawapm.connpass.com']),
  )
})

test('F29-AC6: Given a connpass address with two trailing slashes saved first as an event, When the plain one is added, Then both are the one connpass event', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ kind: 'event', url: 'https://connpass.com/event/123//' })
  await add({ url: 'https://kanagawapm.connpass.com/event/0123/' })
  expect(await allEvents()).toMatchObject([
    { key: 'https://connpass.com/event/123', service: 'connpass', ref: '123' },
  ])
  expect(await ties()).toHaveLength(2)
})

test('F29-AC8: Given an event added with a title, When it is added again with another title, Then its name stays the first title', async () => {
  await seedPublic(db, 'a', 100, 'A')
  await seedPublic(db, 'b', 200, 'B')
  await add(
    {
      url: 'https://kanagawapm.connpass.com/event/1/',
      title: 'Kanagawa.pm #3',
    },
    'a',
  )
  await add(
    { url: 'https://connpass.com/event/1/', title: 'Another name' },
    'b',
  )
  expect((await allEvents()).map((event) => event.name)).toEqual([
    'Kanagawa.pm #3',
  ])
})

test('F27-AC44, F29-AC7: Given a deck in a connpass event, When a link to the same event under another group is added to it, Then it is refused and the deck stays in the event once', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ url: 'https://kanagawapm.connpass.com/event/410635/' })
  const refused = await add({
    url: 'https://yokohamapm.connpass.com/event/410635/',
  })
  expect(refused.headers.get('Location')).toContain('links=duplicate')
  expect(await listLinks(db, 'talk')).toHaveLength(1)
  expect((await ties()).map((tie) => tie.host)).toEqual([
    'kanagawapm.connpass.com',
  ])
  expect(await allEvents()).toHaveLength(1)
})

test('F29-AC8: Given an event first added with no title, When a link with a title is added, Then that title is its name, and a later one does not change it', async () => {
  await seedPublic(db, 'a', 100, 'A')
  await seedPublic(db, 'b', 200, 'B')
  await seedPublic(db, 'c', 300, 'C')
  await add({ url: 'https://luma.com/x1' }, 'a')
  expect((await allEvents()).map((event) => event.name)).toEqual([null])
  await add({ url: 'https://luma.com/x1', title: 'Hono Night #5' }, 'b')
  await add({ url: 'https://luma.com/x1', title: 'Later' }, 'c')
  expect((await allEvents()).map((event) => event.name)).toEqual([
    'Hono Night #5',
  ])
})

test('F29-AC11: Given a link in an event, When it is removed, Then it leaves the event and the event stays', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ url: 'https://luma.com/x1', title: 'Night' })
  const [link] = await listLinks(db, 'talk')
  expect(
    await removeLink(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      linkId: link!.id,
    }),
  ).toBe('removed')
  expect(await ties()).toEqual([])
  expect(await allEvents()).toHaveLength(1)
})

test('F29-AC11: Given a link in an event, When its kind is changed away from event, Then it leaves the event', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ url: 'https://luma.com/x1' })
  const [link] = await listLinks(db, 'talk')
  expect(
    await setLinkKind(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      linkId: link!.id,
      kinding: { kind: 'video' },
      now: 5,
    }),
  ).toBe('changed')
  expect(await kindsOf()).toEqual(['video'])
  expect(await ties()).toEqual([])
})

test('F27-AC88: Given a link, When its kind is changed to event and back to other, Then each kind is the one listed', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({
    kind: 'other',
    url: 'https://example.com/meetup/1',
    title: 'Meetup',
  })
  const [link] = await listLinks(db, 'talk')
  const change = (kinding: Parameters<typeof setLinkKind>[1]['kinding']) =>
    setLinkKind(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      linkId: link!.id,
      kinding,
      now: 5,
    })
  await change({ kind: 'event', event: eventOf(link!.url) })
  expect(await kindsOf()).toEqual(['event'])
  expect((await allEvents()).map((event) => event.name)).toEqual(['Meetup'])
  // Made an event twice, it is still one tie.
  await change({ kind: 'event', event: eventOf(link!.url) })
  expect(await ties()).toHaveLength(1)
  await change({ kind: 'other' })
  expect(await kindsOf()).toEqual(['other'])
  expect(await ties()).toEqual([])
})

test("F27-AC88: Given another author's link, When its kind is changed or it is removed, Then nothing changes", async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ url: 'https://luma.com/x1' })
  const [link] = await listLinks(db, 'talk')
  const foreign = { deckId: 'talk', ownerUserId: 'someone', linkId: link!.id }
  expect(
    await setLinkKind(db, { ...foreign, kinding: { kind: 'video' }, now: 5 }),
  ).toBe('missing')
  expect(await removeLink(db, foreign)).toBe('missing')
  expect(await kindsOf()).toEqual(['event'])
  expect(await ties()).toHaveLength(1)
})

test('F29-AC23: Given one deck, When links to two events are added, Then it is in both events', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ url: 'https://kanagawapm.connpass.com/event/1/' })
  await add({ url: 'https://luma.com/x1' })
  const linked = await listLinks(db, 'talk')
  expect(
    new Set(linked.map((link) => 'eventId' in link && link.eventId)).size,
  ).toBe(2)
  expect(await allEvents()).toHaveLength(2)
})

test('F29-AC13: Given an event address in the article of a deck, When the article is kept, Then the deck is in no event', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await keepArticle(db, {
    deckId: 'talk',
    body: 'I spoke at https://kanagawapm.connpass.com/event/410635/ and [Luma](https://luma.com/x1).',
    status: 'published',
    citations: [],
    now: 10,
  })
  expect(await allEvents()).toEqual([])
  expect(await ties()).toEqual([])
})

test('F29-AC11: Given a full deck, When an event link is refused, Then no event is made', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  for (let index = 0; index < MAX_LINKS; index++)
    await addLink(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      link: { kind: 'other', url: `https://example.com/${index}`, title: null },
      now: 1,
    })
  const url = 'https://luma.com/x1'
  expect(
    await addLink(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      link: { kind: 'event', url, title: 'Night', event: eventOf(url) },
      now: 2,
    }),
  ).toBe('full')
  expect(await allEvents()).toEqual([])
})

test('F29-AC11: Given decks in an event, When one is deleted and its author leaves with the other, Then their ties go and the event stays', async () => {
  await seedPublic(db, 'a', 100, 'A')
  await seedPublic(db, 'b', 200, 'B')
  await add({ url: 'https://luma.com/x1' }, 'a')
  await add({ url: 'https://luma.com/x1' }, 'b')
  await markDeckDeleted(db, { ownerUserId: OWNER_ID, deckId: 'a', now: 300 })
  expect(await ties()).toHaveLength(1)
  await markAccountDeleted(db, { ownerUserId: OWNER_ID, now: 400 })
  expect(await ties()).toEqual([])
  expect(await allEvents()).toHaveLength(1)
})

test('F29-AC16: Given fetch watched, When event links are added, changed and removed, Then nothing is fetched', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  const fetched = vi.spyOn(globalThis, 'fetch')
  try {
    await add({ url: 'https://kanagawapm.connpass.com/event/410635/' })
    await add({ kind: 'event', url: 'https://peatix.com/event/1' })
    const [first, second] = await listLinks(db, 'talk')
    await setLinkKind(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      linkId: first!.id,
      kinding: { kind: 'other' },
      now: 5,
    })
    await removeLink(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      linkId: second!.id,
    })
    expect(fetched).not.toHaveBeenCalled()
  } finally {
    fetched.mockRestore()
  }
})
