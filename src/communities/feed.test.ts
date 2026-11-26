import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { block } from '../blocks/store'
import { applyMigrations } from '../db/test-migrations'
import { mute } from '../mutes/store'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import type { HomeCommunityLists } from '../site/home-communities'
import { followCommunity, unfollowCommunity } from './follow-store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from './test-communities'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

const KANAGAWA = 61
const HONO = 70
const BOB = '2'
const CAROL = '3'
let bob = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetCommunities(db)
  await signIn(env)
  bob = await signIn(env, 'bob', { id: BOB })
  await signIn(env, 'carol', { id: CAROL })
  await seedCommunity(db, {
    id: KANAGAWA,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
  await seedCommunity(db, {
    id: HONO,
    handle: 'hono',
    name: 'Hono Conf',
    links: ['https://hono.connpass.com/'],
    creator: OWNER_ID,
  })
  // The maker follows what they make (F31-AC17); these tests start from
  // communities nobody follows.
  await unfollowCommunity(db, { userId: OWNER_ID, communityId: KANAGAWA })
  await unfollowCommunity(db, { userId: OWNER_ID, communityId: HONO })
})
afterAll(() => platform.dispose())

/** A public deck of `owner`, linked to an event of the community's group. */
async function seedTalk(
  slug: string,
  readyAt: number,
  group: 'kanagawapm' | 'hono',
  owner = OWNER_ID,
) {
  await seedPublic(db, slug, readyAt, slug, owner)
  await seedTalkLink(db, {
    deckId: slug,
    owner,
    url: `https://${group}.connpass.com/event/${readyAt}/`,
  })
}

const open = (path: string, cookie = '') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )
const home = async (cookie = bob) =>
  (await (
    await open('/api/home/communities', cookie)
  ).json()) as HomeCommunityLists | null
const names = (lists: HomeCommunityLists | null) =>
  lists?.talks.map((talk) => talk.name)

describe('the new slides of followed communities on the top page', () => {
  test('F31-AC3: Given ten slides in a followed community, When the top page asks, Then the eight most recently published come, newest first, and nobody else’s answer is kept', async () => {
    for (let n = 1; n <= 10; n += 1)
      await seedTalk(`talk-${n}`, n * 10, 'kanagawapm')
    await followCommunity(db, { userId: BOB, communityId: KANAGAWA, now: 1 })
    const response = await open('/api/home/communities', bob)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const lists = (await response.json()) as HomeCommunityLists
    expect(names(lists)).toEqual(
      [10, 9, 8, 7, 6, 5, 4, 3].map((n) => `talk-${n}`),
    )
  })

  test('F31-AC3: Given slides of followed and other communities, a deck in two followed ones, and one that is not public, When the top page asks, Then each followed slide comes once and nothing else', async () => {
    await seedTalk('kanagawa', 10, 'kanagawapm')
    await seedTalk('hono', 20, 'hono')
    await seedTalk('both', 30, 'kanagawapm')
    await seedTalkLink(db, {
      deckId: 'both',
      url: 'https://hono.connpass.com/event/99/',
    })
    await seedTalk('hidden', 40, 'kanagawapm')
    await applyOperatorCommand(db, {
      deckId: 'hidden',
      command: { kind: 'hide', reason: 'spam', operator: 'op' },
      now: 50,
    })
    await followCommunity(db, { userId: BOB, communityId: HONO, now: 1 })
    await followCommunity(db, { userId: BOB, communityId: KANAGAWA, now: 2 })
    const lists = await home()
    expect(names(lists)).toEqual(['both', 'hono', 'kanagawa'])
    // A deck in two is shown under the community followed first.
    expect(lists?.talks[0]?.community.name).toBe('Hono Conf')
  })

  test('F31-AC4: Given a slide of a followed community, When it comes to the top page, Then its card carries the author, the community’s name, page and color', async () => {
    await seedTalk('talk', 10, 'kanagawapm')
    await followCommunity(db, { userId: BOB, communityId: KANAGAWA, now: 1 })
    expect((await home())?.talks).toEqual([
      expect.objectContaining({
        name: 'talk',
        href: '/@owner/talk',
        handle: 'owner',
        authorHref: '/@owner',
        community: { name: 'Kanagawa.pm', href: '/@kanagawapm', color: 'red' },
      }),
    ])
  })

  test('F03-AC168, F03-AC169: Given a visitor who follows no community, follows one with no slide, or is not signed in, When the followed communities tab asks, Then a signed-in visitor gets an empty list either way, and one not signed in gets nothing', async () => {
    await seedTalk('talk', 10, 'kanagawapm')
    expect(await home()).toEqual({ talks: [] })
    await followCommunity(db, { userId: BOB, communityId: HONO, now: 1 })
    expect(await home()).toEqual({ talks: [] })
    expect(await home('')).toBeNull()
  })

  test('F03-AC158: Given a visitor whose session follows a community, When the top page is served, Then it carries no mark of it, as every tab is there for everyone', async () => {
    await followCommunity(db, { userId: BOB, communityId: HONO, now: 1 })
    const page = await (await open('/', bob)).text()
    expect(page).toContain('data-member="yes"')
    expect(page).not.toMatch(/data-communities="(yes|no)"/)
  })

  test('F31-AC7, F32-AC4: Given the visitor blocked one author and muted another, When the top page and the whole list are read, Then neither author’s slides come', async () => {
    await seedTalk('owners', 10, 'kanagawapm')
    await seedTalk('carols', 20, 'kanagawapm', CAROL)
    await seedTalk('bobs', 30, 'kanagawapm', BOB)
    await followCommunity(db, { userId: BOB, communityId: KANAGAWA, now: 1 })
    expect(names(await home())).toEqual(['bobs', 'carols', 'owners'])

    await block(db, { blocker: BOB, blocked: OWNER_ID, now: 40 })
    await mute(db, { muter: BOB, muted: CAROL, now: 40 })
    expect(names(await home())).toEqual(['bobs'])
    const page = await (await open('/communities/following', bob)).text()
    expect(page).toContain('href="/@bob/bobs"')
    expect(page).not.toContain('href="/@owner/owners"')
    expect(page).not.toContain('href="/@carol/carols"')
  })
})

describe('the whole list', () => {
  test('F31-AC5: Given thirty slides in followed communities, When the list is opened, Then it shows 24 a page, newest first, with the way to the next page and back', async () => {
    for (let n = 1; n <= 30; n += 1)
      await seedTalk(`talk-${n}`, n * 10, n % 2 ? 'kanagawapm' : 'hono')
    await followCommunity(db, { userId: BOB, communityId: KANAGAWA, now: 1 })
    await followCommunity(db, { userId: BOB, communityId: HONO, now: 2 })
    const first = (
      await (await open('/communities/following', bob)).text()
    ).replace(/\s+/g, ' ')
    const cards = (page: string) =>
      [...page.matchAll(/href="\/@owner\/(talk-\d+)"/g)].map((m) => m[1])
    expect(cards(first)).toEqual(
      Array.from({ length: 24 }, (_, i) => `talk-${30 - i}`),
    )
    expect(first).toContain('<h1>フォローしているコミュニティの新着</h1>')
    expect(first).toContain('href="/@kanagawapm">Kanagawa.pm</a>')
    expect(first).toContain('community-mark community-mark-red')
    expect(first).toContain(
      '<a rel="next" href="/communities/following?page=2">次の 24 枚</a>',
    )
    expect(first).not.toContain('rel="prev"')

    const second = await (
      await open('/communities/following?page=2', bob)
    ).text()
    expect(cards(second)).toEqual([6, 5, 4, 3, 2, 1].map((n) => `talk-${n}`))
    expect(second).toContain('rel="prev" href="/communities/following"')
    expect(second).not.toContain('rel="next"')

    // A page past the end leads back to the last page, not to another empty one.
    const past = await (
      await open('/communities/following?page=50', bob)
    ).text()
    expect(past).toContain('このページには、スライドがありません。')
    expect(past).toContain('rel="prev" href="/communities/following?page=2"')
    expect(past).not.toContain('rel="next"')
  })

  test('F31-AC5: Given pages that are not there, When they are opened, Then a page past the end says so, a bad number is not a page, and someone not signed in is sent to sign in', async () => {
    await followCommunity(db, { userId: BOB, communityId: KANAGAWA, now: 1 })
    expect(await (await open('/communities/following', bob)).text()).toContain(
      'フォローしているコミュニティに入ったスライドは、まだありません。',
    )
    expect(
      await (await open('/communities/following?page=3', bob)).text(),
    ).toContain('このページには、スライドがありません。')
    for (const page of ['0', 'x', '-1'])
      expect(
        (await open(`/communities/following?page=${page}`, bob)).status,
      ).toBe(404)
    const signedOut = await open('/communities/following')
    expect(signedOut.status).toBe(303)
    expect(signedOut.headers.get('Location')).toBe('/login')
  })
})
