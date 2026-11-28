import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import {
  blocks,
  decks,
  events,
  mutes,
  relatedLinks,
  suspensions,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { eventRefOf } from '../events/event-url'
import { linkPagePath } from './link-address'
import { listLinks, setLinkKind } from './store'

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

const add = (
  deck: string,
  url: string,
  title = '',
  cookie = owner,
  kind = '',
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/my/slides/${deck}/links`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        url,
        title,
        ...(kind && { kind }),
      }).toString(),
    }),
    env,
  )
type Headers = Record<string, string>
const get = (path: string, headers: Headers = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, { headers }), env)
/** Opens a page; `/events/:id` is followed to the page it moved to. */
const open = async (path: string, headers: Headers = {}) => {
  const response = await get(path, headers)
  const moved = response.status === 301 && response.headers.get('location')
  return moved ? get(moved, headers) : response
}
const flat = async (path: string, headers: Headers = {}) =>
  (await (await open(path, headers)).text()).replace(/\s+/g, ' ')
const EN = { 'Accept-Language': 'en' }
const eventIdOf = async (key: string) =>
  (await orm.select().from(events).where(eq(events.key, key)).get())?.id
const KANAGAWA = 'https://kanagawapm.connpass.com/event/410635/'
const KANAGAWA_KEY = 'https://connpass.com/event/410635'
const KANAGAWA_PAGE = '/link/connpass.com/event/410635'
const talkNames = (body: string) =>
  [...body.matchAll(/<span class="deck-name">([^<]*)<\/span>/g)].map(
    ([, name]) => name,
  )

test('F45-AC3: F45-AC6: Given public slides of two authors with links to one event, written differently, When its page of links opens, Then both are listed', async () => {
  await seedPublic(db, 'talk', 100, 'Owner talk')
  await seedPublic(db, 'reply', 200, 'Bob talk', '2')
  await add('talk', KANAGAWA, 'Kanagawa.pm #3')
  await add('reply', `${KANAGAWA}?utm_source=x`, '', bob)
  const response = await get(KANAGAWA_PAGE)
  expect(response.status).toBe(200)
  const body = (await response.text()).replace(/\s+/g, ' ')
  expect(talkNames(body)).toEqual(['Bob talk', 'Owner talk'])
  expect(body).toContain('href="/@owner/talk"')
  expect(body).toContain('href="/@bob/reply"')
  expect(await orm.select().from(events).all()).toHaveLength(1)
})

test('F45-AC1: F45-AC14: Given slides of two authors published at different times, When the page of links opens, Then they come newest first', async () => {
  await seedPublic(db, 'old', 100, 'Old')
  await seedPublic(db, 'new', 300, 'New')
  await seedPublic(db, 'mid', 200, 'Mid', '2')
  for (const deck of ['old', 'new']) await add(deck, KANAGAWA)
  await add('mid', KANAGAWA, '', bob)
  expect(talkNames(await flat(KANAGAWA_PAGE))).toEqual(['New', 'Mid', 'Old'])
})

test('F45-AC14: Given one deck with two links to the same event, When the page opens, Then it is listed once and counted once', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', KANAGAWA)
  await add('talk', 'https://connpass.com/event/410635/')
  const body = await flat(KANAGAWA_PAGE)
  expect(talkNames(body)).toEqual(['Talk'])
  expect(body).toContain('<span class="event-talks-count">1 本</span>')
})

test('F45-AC14: F45-AC9: Given a draft, a paused and a taken-down slide in an event, When its page of links and its number open, Then both are not found; once one is public, only that one is listed', async () => {
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
  expect((await get(KANAGAWA_PAGE)).status).toBe(404)
  expect((await get(`/events/${id}`)).status).toBe(404)
  await seedPublic(db, 'public', 100, 'Public')
  await add('public', KANAGAWA)
  const body = await flat(KANAGAWA_PAGE)
  expect(talkNames(body)).toEqual(['Public'])
  expect(body).toContain('<span class="event-talks-count">1 本</span>')
})

test('F45-AC14: Given an event with slides of a suspended author and another, When its page opens, Then the suspended author’s is neither listed nor counted; with that author alone, there is no page', async () => {
  await seedPublic(db, 'talk', 100, 'Owner talk')
  await seedPublic(db, 'reply', 200, 'Bob talk', '2')
  await add('talk', KANAGAWA)
  await add('reply', KANAGAWA, '', bob)
  await add('reply', 'https://luma.com/alone', '', bob)
  await orm.insert(suspensions).values({
    user_id: '2',
    reason: 'test',
    suspended_at: 1,
    suspended_by: 'operator',
  })
  const body = await flat(KANAGAWA_PAGE)
  expect(talkNames(body)).toEqual(['Owner talk'])
  expect(body).toContain('<span class="event-talks-count">1 本</span>')
  expect((await get('/link/luma.com/alone')).status).toBe(404)
})

test.each([
  '/events/999',
  '/events/abc',
  '/events/0',
  '/events/1e3',
  '/events/-1',
])(
  'F45-AC9: Given %s, which names no event, When it opens, Then it is not found',
  async (path) => {
    expect((await get(path)).status).toBe(404)
  },
)

test('F45-AC24: F45-AC9: Given an event with one talk, When the link is removed, Then its page of links is the page of no gathering and its number is not found', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', KANAGAWA)
  const id = await eventIdOf(KANAGAWA_KEY)
  expect((await get(KANAGAWA_PAGE)).status).toBe(200)
  const [link] = await listLinks(db, 'talk')
  await server.fetch(
    new Request(`${TEST_ORIGIN}/my/slides/talk/links/${link!.id}/delete`, {
      method: 'POST',
      headers: { Cookie: owner, Origin: TEST_ORIGIN },
    }),
    env,
  )
  const gone = await get(KANAGAWA_PAGE)
  expect(gone.status).toBe(404)
  expect(await gone.text()).toContain('この URL の集まりは、まだありません')
  expect((await get(`/events/${id}`)).status).toBe(404)
})

test('F45-AC16: F45-AC30: Given an event, When its page opens, Then the way to its own page names the site, is rel="noopener nofollow ugc" and asks the reader to check the address', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', `${KANAGAWA}?utm_source=x#top`)
  const body = await flat(KANAGAWA_PAGE)
  expect(body).toContain(
    `<a href="${KANAGAWA}" rel="noopener nofollow ugc" data-link-check aria-haspopup="dialog" >connpass で見る</a >`,
  )
  expect(body).toContain('<template data-link-check-prompt>')
  expect(await flat(KANAGAWA_PAGE, EN)).toContain('>View on connpass</a')
})

test('F45-AC16: Given an event of another site, When its page opens, Then the way out names its host', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  const added = await server.fetch(
    new Request(`${TEST_ORIGIN}/my/slides/talk/links`, {
      method: 'POST',
      headers: {
        Cookie: owner,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        url: 'https://example.com/conf',
        kind: 'event',
      }),
    }),
    env,
  )
  expect(added.status).toBe(303)
  const body = await flat('/link/example.com/conf')
  expect(body).toContain('<h1>example.com https://example.com/conf</h1>')
  expect(sourceOf(body)).toBe('https://example.com/conf')
  expect(body).toContain('>example.com で見る</a')
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
  'F45-AC25: Given links to one connpass event whose first saved one names %s, When its page opens, Then it leads to the event under that first link’s group, or under none',
  async (_, links, source) => {
    await seedPublic(db, 'first', 100, 'First')
    await seedPublic(db, 'second', 200, 'Second', '2')
    await add('first', links[0]!)
    await add('second', links[1]!, '', bob)
    const id = await eventIdOf(KANAGAWA_KEY)
    expect(sourceOf(await flat(`/events/${id}`))).toBe(source)
  },
)

test('F45-AC25: Given the first saved link of a connpass event is on a draft, When the event page opens, Then it follows the oldest link on a public slide instead', async () => {
  await seedDeck(db, 'draft')
  await seedDeployment(db, 'draft')
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('draft', 'https://perl.connpass.com/event/410635/')
  await add('talk', KANAGAWA)
  const id = await eventIdOf(KANAGAWA_KEY)
  expect(sourceOf(await flat(`/events/${id}`))).toBe(KANAGAWA)
})

test('F45-AC25: Given three links to one connpass event, When the first saved one is removed and then the next, Then the page follows the oldest link left each time', async () => {
  // One deck keeps one link to an event (F27-AC44), so each is on its own.
  await seedPublic(db, 'a', 100, 'A')
  await seedPublic(db, 'b', 200, 'B')
  await seedPublic(db, 'c', 300, 'C')
  await add('a', 'https://perl.connpass.com/event/410635/')
  await add('b', 'https://connpass.com/event/410635/')
  await add('c', KANAGAWA)
  const id = await eventIdOf(KANAGAWA_KEY)
  const page = async () => sourceOf(await flat(`/events/${id}`))
  const remove = async (deck: string) => {
    const [link] = await listLinks(db, deck)
    await server.fetch(
      new Request(`${TEST_ORIGIN}/my/slides/${deck}/links/${link!.id}/delete`, {
        method: 'POST',
        headers: { Cookie: owner, Origin: TEST_ORIGIN },
      }),
      env,
    )
  }
  expect(await page()).toBe('https://perl.connpass.com/event/410635/')
  await remove('a')
  expect(await page()).toBe('https://connpass.com/event/410635/')
  await remove('b')
  expect(await page()).toBe(KANAGAWA)
})

test('F45-AC16: F45-AC17: Given an event of no community, When its page opens, Then the head has its heading, the way to its page and the count of slides, and no cover, community, date or place', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', 'https://luma.com/abcd1234', 'Hono Night #5')
  const body = await flat(
    `/events/${await eventIdOf('https://luma.com/abcd1234')}`,
  )
  expect(body).toContain('<h1>Hono Night #5</h1>')
  expect(body).toContain('>Luma で見る</a')
  expect(body).toMatch(/スライド <span class="event-talks-count">1 本<\/span>/)
  expect(body).not.toContain('class="event-community"')
  expect(body).not.toMatch(/class="cover-(pattern|image)"/)
  expect(body).not.toContain('<time datetime="2')
  expect(body).toContain('<title>Hono Night #5')
})

test('F45-AC10: Given an event whose links have no title, When its page opens, in either language, Then its heading is the site and the address', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', KANAGAWA)
  for (const headers of [{}, EN])
    expect(await flat(KANAGAWA_PAGE, headers)).toContain(
      '<h1>connpass https://connpass.com/event/410635/</h1>',
    )
})

test('F45-AC10: Given titled links on a draft, then on two public slides, When the page opens, Then the heading is the first title saved on a public slide; once that link is removed, the next', async () => {
  await seedDeck(db, 'draft')
  await seedDeployment(db, 'draft')
  await seedPublic(db, 'none', 100, 'None')
  await seedPublic(db, 'first', 200, 'First')
  await seedPublic(db, 'second', 300, 'Second', '2')
  await add('draft', KANAGAWA, 'Draft title')
  await add('none', KANAGAWA)
  await add('first', KANAGAWA, 'First title')
  await add('second', KANAGAWA, 'Second title', bob)
  expect(
    (await orm.select().from(events).get())?.name,
    'the event keeps no name',
  ).toBeNull()
  const body = await flat(KANAGAWA_PAGE)
  expect(body).toContain('<h1>First title</h1>')
  expect(body).toContain('<title>First title')
  expect(body).not.toContain('Draft title')
  const [link] = await listLinks(db, 'first')
  await server.fetch(
    new Request(`${TEST_ORIGIN}/my/slides/first/links/${link!.id}/delete`, {
      method: 'POST',
      headers: { Cookie: owner, Origin: TEST_ORIGIN },
    }),
    env,
  )
  expect(await flat(KANAGAWA_PAGE)).toContain('<h1>Second title</h1>')
})

test('F45-AC11: Given an event with a name kept from before, When its page opens, Then the name is the heading, whatever titles its links have', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', KANAGAWA, 'A title')
  await orm.update(events).set({ name: 'Kanagawa.pm #3 (fixed)' })
  expect(await flat(KANAGAWA_PAGE)).toContain('<h1>Kanagawa.pm #3 (fixed)</h1>')
})

test('F45-AC27: Given events of a connpass group, a Doorkeeper group, connpass with no group and Luma, When their pages open, Then only the grouped ones offer to make the community with the group page filled in', async () => {
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

test('F45-AC19: Given fetch watched, When a page of links opens, in each language and from the number of its event, Then nothing is fetched', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add('talk', KANAGAWA)
  const id = await eventIdOf(KANAGAWA_KEY)
  const fetched = vi.spyOn(globalThis, 'fetch')
  try {
    expect((await get(KANAGAWA_PAGE)).status).toBe(200)
    expect((await get(KANAGAWA_PAGE, EN)).status).toBe(200)
    expect((await get(`/events/${id}`)).status).toBe(301)
    expect(fetched).not.toHaveBeenCalled()
  } finally {
    fetched.mockRestore()
  }
})

test('F45-AC3: Given an event title with HTML, When its page opens, Then it is escaped', async () => {
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
  const asOwner = await flat(`/events/${id}`, { Cookie: owner })
  expect(talkNames(asOwner)).toEqual(['Owner talk'])
  expect(asOwner).toContain('<span class="event-talks-count">1 本</span>')
  expect(talkNames(await flat(`/events/${id}`))).toEqual([
    'Bob talk',
    'Owner talk',
  ])
})

test('F45-AC27: Given one connpass number added under two groups, When its page opens, Then it offers no community; with only one group left, it offers that group', async () => {
  await seedPublic(db, 'a', 100, 'A')
  await seedPublic(db, 'b', 200, 'B')
  await add('a', 'https://evil.connpass.com/event/410635/')
  await add('b', KANAGAWA)
  const id = await eventIdOf(KANAGAWA_KEY)
  const both = await flat(`/events/${id}`)
  expect(both).not.toContain('class="event-community-prompt"')
  const [link] = await listLinks(db, 'a')
  await server.fetch(
    new Request(`${TEST_ORIGIN}/my/slides/a/links/${link!.id}/delete`, {
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

test('F45-AC27: Given a group written only on a draft slide, When the event page opens, Then that group is not offered', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await seedDeck(db, 'draft')
  await seedDeployment(db, 'draft')
  await add('talk', 'https://connpass.com/event/410635/')
  await add('draft', KANAGAWA)
  const body = await flat(`/events/${await eventIdOf(KANAGAWA_KEY)}`)
  expect(body).not.toContain('class="event-community-prompt"')
  expect(body).not.toContain('kanagawapm')
})

test("F32-AC22: F45-AC15: Given a viewer who blocked one author, When they open pages of links, Then that author's slides are left out and not counted, a page of that author alone still answers 200 with none, and others see them all", async () => {
  await seedPublic(db, 'talk', 100, 'Owner talk')
  await seedPublic(db, 'reply', 200, 'Bob talk', '2')
  await seedPublic(db, 'solo', 300, 'Bob solo', '2')
  await add('talk', KANAGAWA)
  await add('reply', KANAGAWA, '', bob)
  await add('solo', 'https://perl.connpass.com/event/999/', '', bob)
  const SOLO_PAGE = '/link/connpass.com/event/999'
  await orm
    .insert(blocks)
    .values({ blocker_user_id: '722500', blocked_user_id: '2', created_at: 1 })

  const asOwner = await flat(KANAGAWA_PAGE, { Cookie: owner })
  expect(talkNames(asOwner)).toEqual(['Owner talk'])
  expect(asOwner).toContain('<span class="event-talks-count">1 本</span>')
  const alone = await get(SOLO_PAGE, { Cookie: owner })
  expect(alone.status).toBe(200)
  const none = (await alone.text()).replace(/\s+/g, ' ')
  expect(talkNames(none)).toEqual([])
  expect(none).toContain('<span class="event-talks-count">0 本</span>')
  // The number of the event leads there for the blocker as for anyone.
  const solo = await eventIdOf('https://connpass.com/event/999')
  const moved = await get(`/events/${solo}`, { Cookie: owner })
  expect([moved.status, moved.headers.get('location')]).toEqual([
    301,
    SOLO_PAGE,
  ])

  expect(talkNames(await flat(KANAGAWA_PAGE))).toEqual([
    'Bob talk',
    'Owner talk',
  ])
  expect(talkNames(await flat(SOLO_PAGE, { Cookie: bob }))).toEqual([
    'Bob solo',
  ])
})

test.each([
  ['a connpass event', KANAGAWA, KANAGAWA_KEY, KANAGAWA_PAGE],
  [
    'a Luma event written with lu.ma and capitals',
    'https://lu.ma/AbCd1234?utm_source=x',
    'https://luma.com/AbCd1234',
    '/link/luma.com/AbCd1234',
  ],
])(
  'F45-AC9: Given %s with a public slide, When /events/:id opens, Then it moves for good to the page of links of the event, which lists the slide',
  async (_, url, key, page) => {
    await seedPublic(db, 'talk', 100, 'Talk')
    await add('talk', url)
    expect((await orm.select().from(events).get())?.url).toMatch(/^https:/u)
    const moved = await get(`/events/${await eventIdOf(key)}?lang=en`)
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe(page)
    expect(talkNames(await flat(page))).toEqual(['Talk'])
  },
)

const POST = 'https://example.com/post'
const POST_PAGE = '/link/example.com/post'
const MISSING = 'この URL の集まりは、まだありません'
/** Two public slides, one of each author, newest `reply`. */
const seedTwo = async () => {
  await seedPublic(db, 'talk', 100, 'Owner talk')
  await seedPublic(db, 'reply', 200, 'Bob talk', '2')
}
const removeLink = async (deck: string, cookie: string) =>
  server.fetch(
    new Request(
      `${TEST_ORIGIN}/my/slides/${deck}/links/${(await listLinks(db, deck))[0]!.id}/delete`,
      { method: 'POST', headers: { Cookie: cookie, Origin: TEST_ORIGIN } },
    ),
    env,
  )

test('F45-AC1: F45-AC2: F45-AC24: Given a link that is no event, When slides of one author, then of two, carry it and one leaves again, Then its page shows only with two authors, and otherwise answers as an address nobody added', async () => {
  await seedTwo()
  await seedPublic(db, 'more', 300, 'Owner more')
  const nobody = await get(POST_PAGE)
  await add('talk', POST)
  await add('more', `${POST}/`)
  const alone = await get(POST_PAGE)
  expect([nobody.status, alone.status]).toEqual([404, 404])
  const missing = await alone.text()
  expect(missing).toBe(await nobody.text())
  expect(missing).toContain(MISSING)
  expect(missing).not.toContain('Owner')

  await add('reply', POST, 'A post', bob)
  const shown = await get(POST_PAGE)
  expect(shown.status).toBe(200)
  expect(shown.headers.get('x-robots-tag')).toBeNull()
  const body = (await shown.text()).replace(/\s+/g, ' ')
  expect(talkNames(body)).toEqual(['Owner more', 'Bob talk', 'Owner talk'])
  expect(body).toContain('<span class="event-talks-count">3 本</span>')
  expect(body).toContain('<h1>A post</h1>')
  expect(sourceOf(body)).toBe(POST)
  expect(body).toContain(
    'data-link-check aria-haspopup="dialog" >example.com で見る</a',
  )
  expect(body).not.toContain('class="event-community')

  await orm
    .update(decks)
    .set({ public_deployment_id: null, paused_at: 5 })
    .where(eq(decks.id, 'reply'))
  expect(await (await get(POST_PAGE)).text()).toBe(missing)
})

test('F45-AC10: F45-AC25: Given a link of two authors with no title, When the first saved link is removed, Then the heading is the site and the address, and the way out follows the oldest link left', async () => {
  await seedTwo()
  await seedPublic(db, 'third', 300, 'Third', '2')
  await add('talk', `${POST}?a=1&utm_source=x`)
  await add('reply', `https://www.example.com/post/?a=1`, '', bob)
  await add('third', `${POST}?a=1#x`, '', bob)
  const page = '/link/example.com/post?a=1'
  const body = await flat(page)
  expect(body).toContain('<h1>example.com https://example.com/post?a=1</h1>')
  expect(sourceOf(body)).toBe(`${POST}?a=1`)
  await removeLink('talk', owner)
  expect((await get(page)).status).toBe(404)
  await seedPublic(db, 'again', 400, 'Again')
  await add('again', `${POST}?a=1`)
  expect(sourceOf(await flat(page))).toBe('https://www.example.com/post/?a=1')
})

test.each([
  [
    'www., a final slash, a tracking query and a fragment (F45-AC23)',
    ['https://www.example.com/post/?utm_source=x&fbclid=1#top'],
    POST,
    POST_PAGE,
  ],
  [
    'the start time of a YouTube video (F45-AC5, F27-AC74)',
    ['https://youtu.be/dQw4w9WgXcQ?t=30', 'https://youtu.be/dQw4w9WgXcQ?t=60'],
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    '/link/youtube.com/watch?v=dQw4w9WgXcQ',
  ],
  [
    'the start of a ニコニコ動画 video (F45-AC5, F27-AC77)',
    ['https://nico.ms/sm9?from=30', 'https://nico.ms/sm9'],
    'https://www.nicovideo.jp/watch/sm9?from=5',
    '/link/nicovideo.jp/watch/sm9',
  ],
  [
    'nothing, in Japanese with an IDN host',
    ['https://例え.jp/日本語?q=あ'],
    'https://xn--r8jz45g.jp/%E6%97%A5%E6%9C%AC%E8%AA%9E?q=%E3%81%82',
    '/link/xn--r8jz45g.jp/%E6%97%A5%E6%9C%AC%E8%AA%9E?q=%E3%81%82',
  ],
  [
    'nothing, at the longest address kept',
    [`https://example.com/${'a'.repeat(1980)}`],
    `https://example.com/${'a'.repeat(1980)}`,
    `/link/example.com/${'a'.repeat(1980)}`,
  ],
])(
  'F45-AC1: Given links of two authors that differ only in %s, When the page opens, Then both slides are on one page, a slide with two such links once',
  async (_, mine, theirs, page) => {
    await seedTwo()
    for (const url of mine) expect((await add('talk', url)).status).toBe(303)
    expect(await listLinks(db, 'talk')).toHaveLength(mine.length)
    await add('reply', theirs, '', bob)
    expect(linkPagePath(theirs)).toBe(page)
    const body = await flat(page)
    expect(talkNames(body)).toEqual(['Bob talk', 'Owner talk'])
    expect(body).toContain('<span class="event-talks-count">2 本</span>')
  },
)

test('F45-AC23: Given links of two authors that differ in a % form, in a query, or whose key was never kept, When their pages open, Then none is gathered', async () => {
  await seedTwo()
  await add('talk', 'https://example.com/%41')
  await add('reply', 'https://example.com/A', '', bob)
  await add('talk', 'https://example.com/q?a=1')
  await add('reply', 'https://example.com/q?a=2', '', bob)
  await add('talk', 'https://example.com/old')
  await add('reply', 'https://example.com/old', '', bob)
  await orm
    .update(relatedLinks)
    .set({ gather_key: null })
    .where(eq(relatedLinks.url, 'https://example.com/old'))
  for (const path of ['%41', 'A', 'q?a=1', 'q?a=2', 'q', 'old'])
    expect((await get(`/link/example.com/${path}`)).status).toBe(404)
})

test('F45-AC14: F45-AC15: Given a link of two authors, When one is suspended, Then there is no page; When a reader blocked both, Then the page still answers 200 with no slide', async () => {
  await seedTwo()
  await add('talk', POST)
  await add('reply', POST, '', bob)
  const carol = await signIn(env, 'carol', { id: '3' })
  await orm.insert(blocks).values(
    ['722500', '2'].map((blocked) => ({
      blocker_user_id: '3',
      blocked_user_id: blocked,
      created_at: 1,
    })),
  )
  const blocked = await get(POST_PAGE, { Cookie: carol })
  expect(blocked.status).toBe(200)
  const none = (await blocked.text()).replace(/\s+/g, ' ')
  expect(talkNames(none)).toEqual([])
  expect(none).toContain('<span class="event-talks-count">0 本</span>')
  expect(talkNames(await flat(POST_PAGE))).toHaveLength(2)

  await orm.insert(suspensions).values({
    user_id: '2',
    reason: 'test',
    suspended_at: 1,
    suspended_by: 'operator',
  })
  const gone = await get(POST_PAGE, { Cookie: carol })
  expect(gone.status).toBe(404)
  expect(await gone.text()).toContain(MISSING)
})

test('F45-AC35: F27-AC90: Given one address made an event by one author and added as another kind by two more, When its pages open, Then the address as written is the page of the event, and with a query the links are gathered whatever their kind', async () => {
  await seedTwo()
  await seedPublic(db, 'third', 300, 'Carol talk', '3')
  const carol = await signIn(env, 'carol', { id: '3' })
  const PEATIX = 'https://peatix.com/event/123'
  await add('talk', 'https://www.peatix.com/event/123', '', owner, 'event')
  await add('reply', PEATIX, '', bob, 'article')
  await add('third', PEATIX, '', carol, 'other')
  // The event is looked up as written, www. and all.
  expect(talkNames(await flat('/link/www.peatix.com/event/123'))).toEqual([
    'Owner talk',
  ])
  // No event was written without www.: there the other links are gathered.
  expect(talkNames(await flat('/link/peatix.com/event/123'))).toEqual([
    'Carol talk',
    'Bob talk',
  ])
  await add('reply', `${PEATIX}?day=2`, '', bob, 'video')
  await add('third', `${PEATIX}/?day=2`, '', carol, 'other')
  expect(talkNames(await flat('/link/peatix.com/event/123?day=2'))).toEqual([
    'Carol talk',
    'Bob talk',
  ])
  // Without the event, its path moves to the one of the links of the two.
  await removeLink('talk', owner)
  const moved = await get('/link/www.peatix.com/event/123')
  expect(moved.status).toBe(301)
  expect(moved.headers.get('location')).toBe('/link/peatix.com/event/123')
  expect(talkNames(await flat('/link/peatix.com/event/123'))).toEqual([
    'Carol talk',
    'Bob talk',
  ])
})

test('F45-AC37: Given connpass addresses added with another kind, with a query and with leading zeros, When their pages open, Then they are gathered by the key of their event, one slide being enough', async () => {
  await seedTwo()
  await add('talk', 'https://connpass.com/event/7/?foo=1', '', owner, 'other')
  await add('talk', 'https://connpass.com/event/008/', '', owner, 'other')
  await add('reply', 'https://g.connpass.com/event/8/', '', bob, 'article')
  expect(
    (await orm.select().from(events).all()).map((event) => event.key),
  ).toEqual(['https://connpass.com/event/7', 'https://connpass.com/event/8'])
  expect(talkNames(await flat('/link/connpass.com/event/7'))).toEqual([
    'Owner talk',
  ])
  const written = await get('/link/connpass.com/event/7/?foo=1')
  expect(written.headers.get('location')).toBe('/link/connpass.com/event/7')
  expect(linkPagePath('https://connpass.com/event/008/')).toBe(
    '/link/connpass.com/event/8',
  )
  expect(talkNames(await flat('/link/connpass.com/event/8'))).toEqual([
    'Bob talk',
    'Owner talk',
  ])
})

/** A public deck of the owner with one link, made an event as the tool does. */
async function seedEventOfAnotherSite(deck: string, name: string, url: string) {
  await seedPublic(db, deck, 100, name)
  await add(deck, url)
  const [link] = await listLinks(db, deck)
  await setLinkKind(db, {
    deckId: deck,
    ownerUserId: OWNER_ID,
    linkId: link!.id,
    kinding: { kind: 'event', event: eventRefOf(url)! },
    now: 1,
  })
}

test('F45-AC9: Given two events of another site that differ only by www., each with its own slide, When /events/:id of each opens, Then each moves to its own page, which lists its own slide', async () => {
  await seedEventOfAnotherSite(
    'with',
    'With www',
    'https://www.example.com/conf',
  )
  await seedEventOfAnotherSite('without', 'Without', 'https://example.com/conf')
  const cases = [
    ['https://www.example.com/conf', '/link/www.example.com/conf', 'With www'],
    ['https://example.com/conf', '/link/example.com/conf', 'Without'],
  ] as const
  for (const [key, page, name] of cases) {
    const moved = await get(`/events/${await eventIdOf(key)}`)
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe(page)
    const landed = await get(page)
    expect(landed.status).toBe(200)
    expect(talkNames((await landed.text()).replace(/\s+/g, ' '))).toEqual([
      name,
    ])
  }
})

test.each([
  ['https://loom.com/embed/x', '/link/loom.com/embed/x'],
  ['https://vimeo.com/123/abc', '/link/vimeo.com/123/abc'],
])(
  'F45-AC9: Given %s made an event by the tool, When /events/:id opens, Then it moves to %s, which lists the slide',
  async (url, page) => {
    await seedEventOfAnotherSite('talk', 'Talk', url)
    const moved = await get(`/events/${await eventIdOf(url)}`)
    expect(moved.headers.get('location')).toBe(page)
    expect(talkNames(await flat(page))).toEqual(['Talk'])
  },
)
