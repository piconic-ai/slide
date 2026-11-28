import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { events, lumaEventAliases } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { eventRefOf } from '../events/event-url'
import { resetFeeds } from '../feeds/test-feeds'
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
import { listLinks, setLinkKind } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let owner = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await resetFeeds(db)
  owner = await signIn(env)
})
afterAll(() => platform.dispose())

const open = (path: string, headers: Record<string, string> = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, { headers }), env)
const flat = async (response: Response) =>
  (await response.text()).replace(/\s+/g, ' ')
const add = (deck: string, url: string) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/my/slides/${deck}/links`, {
      method: 'POST',
      headers: {
        Cookie: owner,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ url, title: '' }).toString(),
    }),
    env,
  )
/** A public deck with one link, made an event as the tool does. */
async function seedEventOfAnotherSite(deck: string, url: string) {
  await seedPublic(db, deck, 100, deck)
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
const KANAGAWA = '/link/connpass.com/event/410635'
const NOINDEX = 'noindex, nofollow'

test.each([
  '/link/https://kanagawapm.connpass.com/event/410635/',
  '/link/http://connpass.com/event/410635',
  // What a proxy that makes `//` one slash would hand over.
  '/link/https:/connpass.com/event/410635/',
  '/link/CONNPASS.com/event/410635',
  '/link/www.connpass.com/event/410635',
  '/link/connpass.com/event/410635/',
  '/link/connpass.com/event/410635?utm_source=x',
  '/link/https%3A%2F%2Fconnpass.com%2Fevent%2F410635%2F%3Futm_source%3Dx',
  // F45-AC35: a connpass address is looked up without its query.
  '/link/connpass.com/event/0410635?day=1&lang=en',
])(
  'F45-AC31: Given %s, another way of writing one address, When opened, Then it moves for good to the one path without a scheme',
  async (path) => {
    const response = await open(path)
    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe(KANAGAWA)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  },
)

test('F45-AC31: Given an address of another site written with a scheme, www., a trailing slash and a tracking query, When opened, Then it moves to the one path, its own query kept', async () => {
  const response = await open(
    '/link/https://WWW.Example.com/a/?utm_source=x&b=1',
  )
  expect(response.status).toBe(301)
  expect(response.headers.get('Location')).toBe('/link/example.com/a?b=1')
})

test('F45-AC36: Given an event with a public slide, When its /link/ page opens, Then it shows what the event page shows, may be indexed, names no page by ?lang= and switches the language through /link', async () => {
  await seedPublic(db, 'talk', 100, 'Owner talk')
  await add('talk', 'https://kanagawapm.connpass.com/event/410635/')
  const response = await open(KANAGAWA)
  expect(response.status).toBe(200)
  expect(response.headers.get('X-Robots-Tag')).toBeNull()
  expect(response.headers.get('Link')).toBeNull()
  const body = await flat(response)
  expect(body).toContain('<span class="deck-name">Owner talk</span>')
  expect(body).toContain('href="https://kanagawapm.connpass.com/event/410635/"')
  // F45-AC34: the switch comes back to this page.
  expect(body).toContain(
    'href="/link?to=%2Flink%2Fconnpass.com%2Fevent%2F410635&amp;lang=en"',
  )
})

test('F45-AC12: Given an event whose only slide is a draft, and an address no one wrote, When their /link/ pages open, Then both answer 404 with the same guidance', async () => {
  await seedDeck(db, 'draft')
  await seedDeployment(db, 'draft')
  await add('draft', 'https://connpass.com/event/410635/')
  for (const path of [KANAGAWA, '/link/example.com/nobody']) {
    const response = await open(path)
    expect(response.status).toBe(404)
    const body = await flat(response)
    expect(body).toContain('<h1>この URL の集まりは、まだありません</h1>')
    expect(body).toContain('スライドの関連リンクにこの URL を足すと')
    expect(body).not.toContain('class="deck-name"')
  }
  const english = await flat(
    await open('/link/example.com/nobody', { 'Accept-Language': 'en' }),
  )
  expect(english).toContain('<h1>Nothing is gathered at this URL yet</h1>')
})

test('F45-AC29: Given an address no slides are gathered at, When its page opens, Then it is not to be indexed and the address is text, its marks written as text, and no link', async () => {
  const response = await open(`/link/example.com/a?x=1&y='<b>"`)
  expect(response.status).toBe(404)
  expect(response.headers.get('X-Robots-Tag')).toBe(NOINDEX)
  const body = await flat(response)
  expect(body).toContain(
    '<p class="link-missing-address">https://example.com/a?x=1&amp;y=%27%3Cb%3E%22</p>',
  )
  expect(body).not.toMatch(/href="[^"]*example\.com(?!%2F)[^"]*"/)
  expect(body).not.toContain('<b>')
  expect(body).toContain(
    'href="/link?to=%2Flink%2Fexample.com%2Fa%3Fx%3D1%26y%3D%2527%253Cb%253E%2522&amp;lang=en"',
  )
})

test.each([
  '/link/javascript:alert(1)//secret-word',
  '/link/data:text/html,secret-word',
  '/link/mailto:secret-word@example.com',
  '/link/ftp://example.com/secret-word',
  '/link/https://user:pw@example.com/secret-word',
  '/link/https://exa mple.com/secret-word',
  '/link/https%3A%2F%2Fexample.com%2Fsecret-word%ZZ',
  `/link/example.com/secret-word/${'a'.repeat(2000)}`,
  '/link/',
])(
  'F45-AC13: Given %s, which is not an https address to read, When opened, Then it answers the common 404 and what was written is in no text and no href',
  async (path) => {
    const response = await open(path)
    expect(response.status).toBe(404)
    expect(response.headers.get('X-Robots-Tag')).toBe(NOINDEX)
    const body = await flat(response)
    expect(body).toContain('<h1>ページが見つかりません</h1>')
    expect(body).not.toMatch(/secret-word|example\.com|alert/)
    expect(body).toContain('href="/link?lang=en"')
  },
)

test('F45-AC26: Given a Luma id a feed paired with a name, When the /link/ page of the id opens, Then it moves to the page of the name; an id no feed told stays where it is', async () => {
  await drizzle(db).insert(lumaEventAliases).values({
    alias_key: 'https://luma.com/event/evt-AbC123',
    event_key: 'https://luma.com/Tokyo-Meetup',
    added_at: 1,
  })
  const paired = await open('/link/luma.com/event/evt-AbC123')
  expect(paired.status).toBe(301)
  expect(paired.headers.get('Location')).toBe('/link/luma.com/Tokyo-Meetup')
  expect(
    (await open('/link/lu.ma/event/evt-AbC123')).headers.get('Location'),
  ).toBe('/link/luma.com/event/evt-AbC123')
  expect((await open('/link/luma.com/event/evt-Other1')).status).toBe(404)
})

test("F45-AC33: Given a /link/ address whose own query has lang, When opened, Then the query stays the link's, the screen language is the cookie's and no cookie is written", async () => {
  const path = '/link/example.com/a?lang=ja'
  const response = await open(path, { Cookie: 'language=en' })
  expect(response.headers.get('Set-Cookie')).toBeNull()
  const body = await flat(response)
  expect(body).toContain('<html lang="en">')
  expect(body).toContain('https://example.com/a?lang=ja</p>')
  expect(await flat(await open('/link/example.com/a?lang=en'))).toContain(
    '<html lang="ja">',
  )
})

test("F45-AC8: Given a /link/ address with a query, When opened, Then the whole query is read as the address's own and none as the service's", async () => {
  const body = await flat(await open('/link/example.com/a?lang=en&to=/x&v=2'))
  expect(body).toContain('https://example.com/a?lang=en&amp;to=/x&amp;v=2</p>')
})

test("F45-AC34: Given the footer's switch of a /link/ page, When followed, Then the choice is kept in the cookie and the reader is sent back to the page", async () => {
  const response = await open(
    `/link?to=${encodeURIComponent('/link/example.com/a?b=1&lang=ja')}&lang=en`,
  )
  expect(response.status).toBe(302)
  expect(response.headers.get('Location')).toBe(
    '/link/example.com/a?b=1&lang=ja',
  )
  expect(response.headers.get('Set-Cookie')).toMatch(/^language=en;/)
})

test.each([
  '',
  '?lang=en',
  '?to=',
  '?to=/',
  '?to=/link',
  '?to=/link/',
  '?to=/linker/example.com',
  '?to=//evil.example/link/a',
  '?to=https://evil.example/link/a',
  '?to=/link/../my/slides',
  '?to=/link/javascript:alert(1)',
  '?to=/link/user@evil.example',
  '?to=%5C%5Cevil.example',
])(
  'F45-AC34: Given /link%s, which names no page of links to go back to, When opened, Then it is not found and leads nowhere',
  async (query) => {
    const response = await open(`/link${query}`)
    expect(response.status).toBe(404)
    expect(response.headers.get('Location')).toBeNull()
    expect(response.headers.get('X-Robots-Tag')).toBe(NOINDEX)
  },
)

test.each([
  ['/link///evil.example/a', '/link/evil.example/a'],
  ['/link/%5C%5Cevil.example%5Ca', '/link/evil.example/a'],
  ['/link/https://evil.example', '/link/evil.example/'],
  ['/link/%2F%2Fevil.example', '/link/evil.example/'],
])(
  'F45-AC34: Given /link?to=%s, written to pass for a way out, When opened, Then the reader stays on this site, at the page of links of that address',
  async (to, location) => {
    const response = await open(`/link?to=${to}`)
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(location)
  },
)

test('F45-AC35: Given an event of another site kept with www., When /link/ opens without it, Then the event is found; with a query it is not, and the www. path moves to the one without', async () => {
  await seedEventOfAnotherSite('conf', 'https://www.example.com/conf/')
  await seedEventOfAnotherSite('meet', 'https://example.org/Meet')
  const found = await open('/link/example.com/conf')
  expect(found.status).toBe(200)
  expect(await flat(found)).toContain('<span class="deck-name">conf</span>')
  expect((await open('/link/example.org/Meet')).status).toBe(200)
  expect((await open('/link/example.org/meet')).status).toBe(404)
  expect((await open('/link/example.com/conf?day=1')).status).toBe(404)
  expect((await open('/link/example.com/conf/2026')).status).toBe(404)
  const written = await open('/link/www.example.com/conf')
  expect(written.headers.get('Location')).toBe('/link/example.com/conf')
})

test('F45-AC9: Given an event of another site kept with www., When /events/:id opens, Then it moves for good to the path without it, where the event is found', async () => {
  await seedEventOfAnotherSite('conf', 'https://www.example.com/conf/')
  const [event] = await drizzle(db).select().from(events)
  const moved = await open(`/events/${event!.id}`)
  expect(moved.status).toBe(301)
  expect(moved.headers.get('Location')).toBe('/link/example.com/conf')
  expect(moved.headers.get('X-Robots-Tag')).toBe(NOINDEX)
})

test('F30-AC74: Given /@link, When opened, Then no profile answers there', async () => {
  expect((await open('/@link')).status).toBe(404)
})
