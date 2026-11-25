import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { blocks, decks, events, mutes } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { listLinks } from '../links/store'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { listListedEvents } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let owner = ''
let bob = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  owner = await signIn(env)
  bob = await signIn(env, 'bob', { id: '2' })
})
afterAll(() => platform.dispose())

const add = (deck: string, url: string, title = '', cookie = owner) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/slides/${deck}/links`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ url, title }).toString(),
    }),
    env,
  )
const open = (path: string) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)
const flat = async (path: string) =>
  (await (await open(path)).text()).replace(/\s+/g, ' ')
const eventIdOf = async (key: string) =>
  (await orm.select().from(events).where(eq(events.key, key)).get())?.id
const KANAGAWA = 'https://kanagawapm.connpass.com/event/410635/'
const KANAGAWA_KEY = 'https://connpass.com/event/410635'
const talkNames = (body: string) =>
  [...body.matchAll(/<span class="deck-name">([^<]*)<\/span>/g)].map(
    ([, name]) => name,
  )

test('F29-AC5: Given public slides of two authors with links to one event, When its page opens, Then both are listed as talks', async () => {
  await seedPublic(db, 'talk', 100, 'Owner talk')
  await seedPublic(db, 'reply', 200, 'Bob talk', '2')
  await add('talk', KANAGAWA, 'Kanagawa.pm #3')
  await add('reply', `${KANAGAWA}?utm_source=x`, '', bob)
  const id = await eventIdOf(KANAGAWA_KEY)
  const response = await open(`/events/${id}`)
  expect(response.status).toBe(200)
  const body = (await response.text()).replace(/\s+/g, ' ')
  expect(talkNames(body)).toEqual(['Bob talk', 'Owner talk'])
  expect(body).toContain('href="/@owner/talk"')
  expect(body).toContain('href="/@bob/reply"')
  expect(await orm.select().from(events).all()).toHaveLength(1)
})

test('F29-AC10: Given talks published at different times, When the event page opens, Then they come newest first, and events come by their first public talk, newest first', async () => {
  await seedPublic(db, 'old', 100, 'Old')
  await seedPublic(db, 'new', 300, 'New')
  await seedPublic(db, 'mid', 200, 'Mid')
  for (const deck of ['old', 'new', 'mid']) await add(deck, KANAGAWA)
  await add('mid', 'https://luma.com/second')
  await add('new', 'https://luma.com/third')
  const id = await eventIdOf(KANAGAWA_KEY)
  expect(talkNames(await flat(`/events/${id}`))).toEqual(['New', 'Mid', 'Old'])
  // First public talks: KANAGAWA 100, second 200, third 300.
  expect(await listListedEvents(db, { limit: 10 })).toEqual([
    await eventIdOf('https://luma.com/third'),
    await eventIdOf('https://luma.com/second'),
    id,
  ])
  expect(await listListedEvents(db, { limit: 10, within: [id!] })).toEqual([id])
})

test('F29-AC10: Given one deck with two links to the same event, When the page opens, Then it is listed once and counted once', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', KANAGAWA)
  await add('talk', 'https://connpass.com/event/410635/')
  const body = await flat(`/events/${await eventIdOf(KANAGAWA_KEY)}`)
  expect(talkNames(body)).toEqual(['Talk'])
  expect(body).toContain('<span class="event-talks-count">1 本</span>')
})

test('F29-AC12: Given a draft, a paused and a taken-down slide in an event, When its page opens, Then it is not found; once one is public, only that one is listed', async () => {
  await seedDeck(db, 'draft')
  await seedDeployment(db, 'draft')
  await seedPublic(db, 'paused', 100, 'Paused')
  await seedPublic(db, 'hidden', 100, 'Hidden')
  for (const deck of ['draft', 'paused', 'hidden']) await add(deck, KANAGAWA)
  await orm
    .update(decks)
    .set({ public_deployment_id: null, paused_at: 5 })
    .where(eq(decks.id, 'paused'))
  await orm
    .update(decks)
    .set({ hidden_at: 5, hidden_reason: 'x', hidden_by: 'op@example.com' })
    .where(eq(decks.id, 'hidden'))
  const id = await eventIdOf(KANAGAWA_KEY)
  expect((await open(`/events/${id}`)).status).toBe(404)
  expect(await listListedEvents(db, { limit: 10 })).toEqual([])
  await seedPublic(db, 'public', 100, 'Public')
  await add('public', KANAGAWA)
  expect(talkNames(await flat(`/events/${id}`))).toEqual(['Public'])
})

test.each([
  '/events/999',
  '/events/abc',
  '/events/0',
  '/events/1e3',
  '/events/-1',
])(
  'F29-AC12: Given %s, which names no event, When it opens, Then it is not found',
  async (path) => {
    expect((await open(path)).status).toBe(404)
  },
)

test('F29-AC11: Given an event with one talk, When the link is removed, Then the page is not found', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', KANAGAWA)
  const id = await eventIdOf(KANAGAWA_KEY)
  expect((await open(`/events/${id}`)).status).toBe(200)
  const [link] = await listLinks(db, 'talk')
  await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk/links/${link!.id}/delete`, {
      method: 'POST',
      headers: { Cookie: owner, Origin: TEST_ORIGIN },
    }),
    env,
  )
  expect((await open(`/events/${id}`)).status).toBe(404)
})

test('F29-AC14: Given an event, When its page opens, Then the way to its own page names the service and is rel="noopener nofollow ugc"', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', `${KANAGAWA}?utm_source=x#top`)
  const id = await eventIdOf(KANAGAWA_KEY)
  expect(await flat(`/events/${id}`)).toContain(
    `<a href="${KANAGAWA}" rel="noopener nofollow ugc" >connpass で見る</a >`,
  )
  expect(await flat(`/events/${id}?lang=en`)).toContain('>View on connpass</a')
})

const sourceOf = (body: string) =>
  /<a href="([^"]*)" rel="noopener nofollow ugc"/.exec(body)?.[1]

test.each([
  [
    'a group',
    [
      'https://kanagawapm.connpass.com/event/410635/',
      'https://perl.connpass.com/event/410635/',
    ],
    'https://kanagawapm.connpass.com/event/410635/',
  ],
  [
    'no group',
    ['https://connpass.com/event/410635/', KANAGAWA],
    'https://connpass.com/event/410635/',
  ],
  [
    'a group in capitals, a query and leading zeros',
    [
      'https://KanagawaPM.Connpass.com/event/0410635?utm_source=x#top',
      'https://perl.connpass.com/event/410635/',
    ],
    'https://kanagawapm.connpass.com/event/410635/',
  ],
])(
  'F29-AC14: Given links to one connpass event whose first saved one names %s, When its page opens, Then it leads to the event under that first link’s group, or under none',
  async (_, links, source) => {
    await seedPublic(db, 'first', 100, 'First')
    await seedPublic(db, 'second', 200, 'Second', '2')
    await add('first', links[0]!)
    await add('second', links[1]!, '', bob)
    const id = await eventIdOf(KANAGAWA_KEY)
    expect(sourceOf(await flat(`/events/${id}`))).toBe(source)
  },
)

test('F29-AC14: Given the first saved link of a connpass event is on a draft, When the event page opens, Then it follows the oldest link on a public slide instead', async () => {
  await seedDeck(db, 'draft')
  await seedDeployment(db, 'draft')
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('draft', 'https://perl.connpass.com/event/410635/')
  await add('talk', KANAGAWA)
  const id = await eventIdOf(KANAGAWA_KEY)
  expect(sourceOf(await flat(`/events/${id}`))).toBe(KANAGAWA)
})

test('F29-AC14: Given three links to one connpass event, When the first saved one is removed and then the next, Then the page follows the oldest link left each time', async () => {
  await seedPublic(db, 'a', 100, 'A')
  await add('a', 'https://perl.connpass.com/event/410635/')
  await add('a', 'https://connpass.com/event/410635/')
  await add('a', KANAGAWA)
  const id = await eventIdOf(KANAGAWA_KEY)
  const page = async () => sourceOf(await flat(`/events/${id}`))
  const remove = async (index: number) => {
    const link = (await listLinks(db, 'a'))[index]!
    await server.fetch(
      new Request(`${TEST_ORIGIN}/slides/a/links/${link.id}/delete`, {
        method: 'POST',
        headers: { Cookie: owner, Origin: TEST_ORIGIN },
      }),
      env,
    )
  }
  expect(await page()).toBe('https://perl.connpass.com/event/410635/')
  await remove(0)
  expect(await page()).toBe('https://connpass.com/event/410635/')
  await remove(0)
  expect(await page()).toBe(KANAGAWA)
})

test('F29-AC19: Given an event of no community, When its page opens, Then the head has its name, the way to its page and the count of talks, and no community, date or place', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', 'https://luma.com/abcd1234', 'Hono Night #5')
  const body = await flat(
    `/events/${await eventIdOf('https://luma.com/abcd1234')}`,
  )
  expect(body).toContain('<h1>Hono Night #5</h1>')
  expect(body).toContain('>Luma で見る</a')
  expect(body).toMatch(/発表 <span class="event-talks-count">1 本<\/span>/)
  expect(body).not.toContain('class="event-community"')
  expect(body).not.toContain('<time datetime="2')
  expect(body).toContain('<title>Hono Night #5')
})

test('F29-AC9: Given an event whose links have no title, When its page opens, Then it is named by the service and number', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', KANAGAWA)
  expect(await flat(`/events/${await eventIdOf(KANAGAWA_KEY)}`)).toContain(
    '<h1>connpass のイベント 410635</h1>',
  )
})

test('F29-AC20: Given events of a connpass group, a Doorkeeper group, connpass with no group and Luma, When their pages open, Then only the grouped ones offer to make the community with the group page filled in', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  const cases = [
    [KANAGAWA, KANAGAWA_KEY, 'https://kanagawapm.connpass.com/'],
    [
      'https://rubykaigi.doorkeeper.jp/events/1',
      'https://rubykaigi.doorkeeper.jp/events/1',
      'https://rubykaigi.doorkeeper.jp/',
    ],
    ['https://connpass.com/event/7/', 'https://connpass.com/event/7', null],
    ['https://luma.com/x1', 'https://luma.com/x1', null],
  ] as const
  for (const [url] of cases) await add('talk', url)
  for (const [, key, group] of cases) {
    const body = await flat(`/events/${await eventIdOf(key)}`)
    if (group === null) {
      expect(body).not.toContain('class="event-community-prompt"')
      continue
    }
    expect(body).toContain('このグループのコミュニティはまだありません')
    expect(body).toContain(
      `href="/communities/new?link=${encodeURIComponent(group)}" >作る</a`,
    )
  }
})

test('F29-AC21: Given an event of no community, When its page opens twice, Then it has the same default pattern in the color its number picks, as one image named by the event', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', KANAGAWA, 'Kanagawa.pm #3')
  const id = (await eventIdOf(KANAGAWA_KEY))!
  const pattern = (body: string) =>
    /<div class="cover-pattern"[\s\S]*?<\/div>/.exec(body)?.[0] ?? ''
  const first = pattern(await flat(`/events/${id}`))
  const second = pattern(await flat(`/events/${id}`))
  expect(first).toBe(second)
  expect(first).toContain('role="img" aria-label="Kanagawa.pm #3 のカバー画像"')
  const color = ['red', 'orange', 'yellow', 'green', 'navy'][id % 5]
  const squares = [...first.matchAll(/var\(--community-([a-z]+)/g)]
  expect(squares).toHaveLength(32)
  expect(new Set(squares.map(([, name]) => name))).toEqual(new Set([color]))
})

test('F29-AC16: Given fetch watched, When an event page opens, Then nothing is fetched', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', KANAGAWA)
  const id = await eventIdOf(KANAGAWA_KEY)
  const fetched = vi.spyOn(globalThis, 'fetch')
  try {
    expect((await open(`/events/${id}`)).status).toBe(200)
    expect((await open(`/events/${id}?lang=en`)).status).toBe(200)
    expect(fetched).not.toHaveBeenCalled()
  } finally {
    fetched.mockRestore()
  }
})

test('F29-AC5: Given an event title with HTML, When its page opens, Then it is escaped', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', KANAGAWA, '<script>alert(1)</script>')
  const body = await flat(`/events/${await eventIdOf(KANAGAWA_KEY)}`)
  expect(body).not.toContain('<script>alert(1)')
  expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
})

test("F19-AC2: Given a viewer who muted one author of an event, When they open its page, Then that author's talk is left out and not counted, and others still see it", async () => {
  await seedPublic(db, 'talk', 100, 'Owner talk')
  await seedPublic(db, 'reply', 200, 'Bob talk', '2')
  await add('talk', KANAGAWA)
  await add('reply', KANAGAWA, '', bob)
  await orm
    .insert(mutes)
    .values({ muter_user_id: '722500', muted_user_id: '2', created_at: 1 })
  const id = await eventIdOf(KANAGAWA_KEY)
  const asOwner = (
    await (
      await server.fetch(
        new Request(`${TEST_ORIGIN}/events/${id}`, {
          headers: { Cookie: owner },
        }),
        env,
      )
    ).text()
  ).replace(/\s+/g, ' ')
  expect(talkNames(asOwner)).toEqual(['Owner talk'])
  expect(asOwner).toContain('<span class="event-talks-count">1 本</span>')
  expect(talkNames(await flat(`/events/${id}`))).toEqual([
    'Bob talk',
    'Owner talk',
  ])
  expect(await listListedEvents(db, { limit: 10, viewer: '722500' })).toEqual([
    id,
  ])
})

test('F29-AC20: Given one connpass number added under two groups, When its page opens, Then it offers no community; with only one group left, it offers that group', async () => {
  await seedPublic(db, 'a', 100, 'A')
  await seedPublic(db, 'b', 200, 'B')
  await add('a', 'https://evil.connpass.com/event/410635/')
  await add('b', KANAGAWA)
  const id = await eventIdOf(KANAGAWA_KEY)
  const both = await flat(`/events/${id}`)
  expect(both).not.toContain('class="event-community-prompt"')
  const [link] = await listLinks(db, 'a')
  await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/a/links/${link!.id}/delete`, {
      method: 'POST',
      headers: { Cookie: owner, Origin: TEST_ORIGIN },
    }),
    env,
  )
  const one = await flat(`/events/${id}`)
  expect(one).toContain(
    `href="/communities/new?link=${encodeURIComponent('https://kanagawapm.connpass.com/')}"`,
  )
})

test('F29-AC20: Given a group written only on a draft slide, When the event page opens, Then that group is not offered', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await seedDeck(db, 'draft')
  await seedDeployment(db, 'draft')
  await add('talk', 'https://connpass.com/event/410635/')
  await add('draft', KANAGAWA)
  const body = await flat(`/events/${await eventIdOf(KANAGAWA_KEY)}`)
  expect(body).not.toContain('class="event-community-prompt"')
  expect(body).not.toContain('kanagawapm')
})

test("F32-AC4: Given a viewer who blocked one author, When they open an event's page and the list of events, Then that author's talks are left out and not counted, an event of that author alone is not listed, and others still see both", async () => {
  await seedPublic(db, 'talk', 100, 'Owner talk')
  await seedPublic(db, 'reply', 200, 'Bob talk', '2')
  await seedPublic(db, 'solo', 300, 'Bob solo', '2')
  await add('talk', KANAGAWA)
  await add('reply', KANAGAWA, '', bob)
  await add('solo', 'https://perl.connpass.com/event/999/', '', bob)
  const id = await eventIdOf(KANAGAWA_KEY)
  const solo = await eventIdOf('https://connpass.com/event/999')
  await orm
    .insert(blocks)
    .values({ blocker_user_id: '722500', blocked_user_id: '2', created_at: 1 })

  const asOwner = (
    await (
      await server.fetch(
        new Request(`${TEST_ORIGIN}/events/${id}`, {
          headers: { Cookie: owner },
        }),
        env,
      )
    ).text()
  ).replace(/\s+/g, ' ')
  expect(talkNames(asOwner)).toEqual(['Owner talk'])
  expect(asOwner).toContain('<span class="event-talks-count">1 本</span>')
  expect(await listListedEvents(db, { limit: 10, viewer: '722500' })).toEqual([
    id,
  ])
  expect(talkNames(await flat(`/events/${id}`))).toEqual([
    'Bob talk',
    'Owner talk',
  ])
  expect(await listListedEvents(db, { limit: 10, viewer: '2' })).toEqual([
    solo,
    id,
  ])
})
