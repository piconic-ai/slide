import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { block } from '../blocks/store'
import { communities, handles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import type { CommunityCard } from './community-card'
import { listNewCommunities } from './list-store'
import { resetCommunities, seedCommunity } from './test-communities'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = testEnv(platform.env) as unknown as Env
const BOB = '2'
let bob = ''

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetCommunities(db)
  await signIn(env)
  bob = await signIn(env, 'bob', { id: BOB })
})
afterAll(() => platform.dispose())

/**
 * Makes `count` communities straight in D1, community `n` made at second
 * `n`: no links, so none has talks.
 */
async function seedMany(count: number, from = 1) {
  const orm = drizzle(db)
  for (let n = from; n < from + count; n += 1) {
    await orm.insert(communities).values({
      id: n,
      name: `Community ${n}`,
      color: 'navy',
      created_at: n,
    })
    await orm.insert(handles).values({
      handle: `c${n}`,
      owner_kind: 'community',
      owner_id: String(n),
      created_at: n,
    })
  }
}

const open = (path: string, cookie = '') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )
const hrefs = async (response: Response) =>
  [
    ...(await response.text()).matchAll(
      /<li class="community-card">\s*<a href="\/@([a-z0-9-]+)"/g,
    ),
  ].map((match) => match[1])

test('F30-AC47: Given communities made at different times, When /communities is opened signed out, Then every one is listed, the newest made first, though none has a talk', async () => {
  await seedMany(3)
  const response = await open('/communities')
  expect(response.status).toBe(200)
  expect(await hrefs(response)).toEqual(['c3', 'c2', 'c1'])
})

test('F30-AC47: Given communities made in the same second, When the list is read, Then they keep one order', async () => {
  const orm = drizzle(db)
  await seedMany(3)
  await orm.update(communities).set({ created_at: 5 })
  const first = await listNewCommunities(db, { limit: 50, offset: 0 })
  const again = await listNewCommunities(db, { limit: 50, offset: 0 })
  expect(first.map((row) => row.id)).toEqual([3, 2, 1])
  expect(again).toEqual(first)
})

test('F30-AC47: Given 51 communities, When the pages are opened, Then the first has 50 and "next", the second has the oldest and "previous"', async () => {
  await seedMany(51)
  const first = await open('/communities')
  const firstHtml = await first.clone().text()
  expect(await hrefs(first)).toHaveLength(50)
  expect(firstHtml).toContain('rel="next" href="/communities?page=2"')
  expect(firstHtml).not.toContain('rel="prev"')
  const second = await open('/communities?page=2')
  const secondHtml = await second.clone().text()
  expect(await hrefs(second)).toEqual(['c1'])
  expect(secondHtml).toContain('rel="prev" href="/communities"')
  expect(secondHtml).not.toContain('rel="next"')
})

test('F30-AC47: Given a page past the end, When it is opened, Then it says no community is there and leads back', async () => {
  await seedMany(2)
  const response = await open('/communities?page=3')
  expect(response.status).toBe(200)
  const body = await response.text()
  expect(body).toContain('このページには、コミュニティがありません。')
  expect(body).toContain('rel="prev" href="/communities"')
})

test.each(['0', '-1', 'two', '1.5', ''])(
  'F30-AC47: Given ?page=%s, When /communities is opened, Then it is not found',
  async (page) => {
    const response = await open(`/communities?page=${page}`)
    expect(response.status).toBe(404)
  },
)

test('F30-AC47: Given no community, When /communities is opened, Then it says there is none yet, in each language', async () => {
  expect(await (await open('/communities')).text()).toContain(
    'コミュニティは、まだありません。',
  )
  expect(await (await open('/communities?lang=en')).text()).toContain(
    'No communities yet.',
  )
})

test('F30-AC47: Given a community made by someone the reader blocked, When the reader opens /communities, Then it is listed: a community is not a person', async () => {
  await seedCommunity(db, {
    id: 61,
    handle: 'kanagawapm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
  await block(db, { blocker: BOB, blocked: OWNER_ID, now: 40 })
  expect(await hrefs(await open('/communities', bob))).toEqual(['kanagawapm'])
})

test('F30-AC47: Given a community being deleted, which holds no handle, When /communities is opened, Then it is neither listed nor counted', async () => {
  await seedMany(2)
  await drizzle(db).delete(handles).where(eq(handles.handle, 'c2'))
  const response = await open('/communities')
  expect(await hrefs(response)).toEqual(['c1'])
  const [row] = await drizzle(db).all<{ count: number }>(
    sql`SELECT count(*) AS count FROM ${communities}`,
  )
  expect(row?.count).toBe(2)
})

test('F30-AC46: Given a community with a description, When it is listed, Then its card shows the name and description and no follow button', async () => {
  await seedMany(1)
  await drizzle(db)
    .update(communities)
    .set({ description: 'Meetups in Yokohama' })
  const body = (await (await open('/communities', bob)).text()).replace(
    /\s+/g,
    ' ',
  )
  expect(body).toContain('Community 1')
  expect(body).toContain('Meetups in Yokohama')
  expect(body).not.toContain('action="/communities/follows')
})

test('F03-AC161: Given seven communities, When the recent communities tab asks for its first ones signed in or not, Then both get the same six newest as cards, kept a minute by any cache', async () => {
  await seedMany(7)
  const signedOut = await open('/api/public/communities')
  expect(signedOut.headers.get('Cache-Control')).toBe('public, max-age=60')
  const cards = (await signedOut.json()) as CommunityCard[]
  expect(cards.map((card) => card.href)).toEqual(
    ['c7', 'c6', 'c5', 'c4', 'c3', 'c2'].map((handle) => `/@${handle}`),
  )
  expect(cards[0]?.cover.kind).toBe('pattern')
  const signedIn = await open('/api/public/communities', bob)
  expect(await signedIn.json()).toEqual(cards)
})

test('F03-AC158, F03-AC175: Given the top page a visitor who is not signed in opens, When it is served, Then four tabs stand in order over four panels, and the recent communities panel holds room for six', async () => {
  const html = await (await open('/')).text()
  const tabs = [
    ...html.matchAll(/role="tab"[^>]*>(?:<!--[^>]*-->)?([^<]+)</g),
  ].map((match) => match[1])
  expect(tabs).toEqual([
    '最近のスライド',
    '最近のコミュニティ',
    'フォロー',
    'フォローコミュニティ',
  ])
  const panel = html.indexOf('id="home-tab-communities-panel"')
  expect(panel).toBeGreaterThan(0)
  const placeholders = html
    .slice(panel)
    .split('</ul>')[0]
    ?.match(/<li[^>]*class="community-card"/g)
  expect(placeholders).toHaveLength(6)
  expect(html).not.toContain('id="new-communities"')
})
