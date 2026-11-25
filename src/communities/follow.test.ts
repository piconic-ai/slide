import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { block } from '../blocks/store'
import {
  communityFollows,
  follows,
  notifications,
  suspensions,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { markAccountDeleted } from '../decks/deletion-store'
import { mute } from '../mutes/store'
import { notifyFolloweePublished } from '../notifications/store'
import {
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { deleteCommunity } from './admin-store'
import { followCommunity } from './follow-store'
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

const ID = 61
const BOB = '2'
const CAROL = '3'
let owner = ''
let bob = ''
let carol = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetCommunities(db)
  owner = await signIn(env)
  bob = await signIn(env, 'bob', { id: BOB })
  carol = await signIn(env, 'carol', { id: CAROL, name: 'Carol' })
  await seedCommunity(db, {
    id: ID,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
})
afterAll(() => platform.dispose())

const send = (
  path: string,
  fields: Readonly<Record<string, string>>,
  cookie: string,
  accept?: string,
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(accept ? { Accept: accept } : {}),
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )
const follow = (cookie: string, back = '/@kanagawapm', handle = 'kanagawapm') =>
  send('/communities/follows', { handle, back }, cookie)
const release = (cookie: string, back = '/@kanagawapm') =>
  send('/communities/follows/release', { handle: 'kanagawapm', back }, cookie)
const open = (path: string, cookie = '') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )
const flat = async (response: Response) =>
  (await response.text()).replace(/\s+/g, ' ')
const followers = async (communityId = ID) =>
  (
    await orm
      .select({ userId: communityFollows.user_id })
      .from(communityFollows)
      .where(eq(communityFollows.community_id, communityId))
  )
    .map((row) => row.userId)
    .sort()

describe('following a community', () => {
  test('F31-AC1: Given a signed-in reader, When they press "follow" and then "following", Then the community is followed and then let go, the ink pill turning white and back', async () => {
    const before = await flat(await open('/@kanagawapm', bob))
    expect(before).toContain('action="/communities/follows"')
    expect(before).toContain(
      '<button class="button-primary" type="submit" aria-label="Kanagawa.pm をフォローする"> フォロー </button>',
    )

    const followed = await follow(bob)
    expect(followed.status).toBe(303)
    expect(followed.headers.get('Location')).toBe('/@kanagawapm')
    expect(await followers()).toEqual([BOB])
    const after = await flat(await open('/@kanagawapm', bob))
    expect(after).toContain('action="/communities/follows/release"')
    expect(after).toContain('class="button-secondary following"')
    expect(after).toContain('aria-label="Kanagawa.pm のフォローを解除する"')
    expect(after).toContain('<span class="state">フォロー中</span')

    const released = await release(bob)
    expect(released.headers.get('Location')).toBe('/@kanagawapm')
    expect(await followers()).toEqual([])
    expect(await flat(await open('/@kanagawapm', bob))).toContain(
      'action="/communities/follows"',
    )
  })

  test('F31-AC1: Given a script asking for JSON, When it follows and lets go, Then each answer says whether the reader follows now', async () => {
    const json = 'application/json'
    const followed = await send(
      '/communities/follows',
      { handle: 'kanagawapm', back: '/@kanagawapm' },
      bob,
      json,
    )
    expect(await followed.json()).toEqual({ following: true })
    const again = await send(
      '/communities/follows',
      { handle: 'kanagawapm', back: '/@kanagawapm' },
      bob,
      json,
    )
    expect(await again.json()).toEqual({ following: true })
    const released = await send(
      '/communities/follows/release',
      { handle: 'kanagawapm', back: '/@kanagawapm' },
      bob,
      json,
    )
    expect(await released.json()).toEqual({ following: false })
  })

  test('F31-AC1: Given a second press of "follow", When it is stored, Then the first follow and its time stay', async () => {
    expect(
      await followCommunity(db, { userId: BOB, communityId: ID, now: 10 }),
    ).toBe(true)
    expect(
      await followCommunity(db, { userId: BOB, communityId: ID, now: 20 }),
    ).toBe(false)
    const rows = await orm.select().from(communityFollows)
    expect(rows).toEqual([{ user_id: BOB, community_id: ID, created_at: 10 }])
  })

  test('F31-AC1: Given handles that name no community, When they are followed, Then nothing is stored and the reader goes back', async () => {
    for (const handle of ['nobody', 'bob', 'BAD!', '']) {
      const response = await follow(carol, '/@kanagawapm', handle)
      expect(response.status).toBe(303)
      expect(response.headers.get('Location')).toBe('/@kanagawapm')
    }
    expect(await orm.select().from(communityFollows)).toEqual([])
  })

  test('F31-AC1: Given a way back that is not a page of the service, When the form is sent, Then the reader is not sent there', async () => {
    const response = await follow(bob, 'https://evil.example/')
    expect(response.headers.get('Location')).toBe('/slides')
    expect(await followers()).toEqual([BOB])
  })

  test('F31-AC1: Given a community that is gone or a suspended person, When a follow is stored, Then none is', async () => {
    expect(
      await followCommunity(db, { userId: BOB, communityId: 999, now: 1 }),
    ).toBe(false)
    expect(
      await followCommunity(db, { userId: 'nobody', communityId: ID, now: 1 }),
    ).toBe(false)
    await orm.insert(suspensions).values({
      user_id: CAROL,
      reason: 'spam',
      suspended_at: 1,
      suspended_by: 'operator',
    })
    expect(
      await followCommunity(db, { userId: CAROL, communityId: ID, now: 1 }),
    ).toBe(false)
    expect(await followers()).toEqual([])
  })

  test('F31-AC2: Given a reader who is not signed in, When the page is drawn, Then "follow" opens the sign-in prompt, which returns to the community', async () => {
    const page = await flat(await open('/@kanagawapm'))
    expect(page).toContain('data-login-prompt="follow-community"')
    expect(page).toContain('href="/login?to=%2F%40kanagawapm"')
    expect(page).toContain(
      '<template data-login-prompt-for="follow-community">',
    )
    expect(page).toContain(
      'ログインすると、フォローしたコミュニティに入った新しいスライドが、トップに並びます。',
    )
    expect(page).not.toContain('action="/communities/follows"')
  })

  test('F31-AC2: Given a reader who is not signed in, When the form is sent anyway, Then nothing is stored and they are sent to sign in and back', async () => {
    const response = await follow('', '/@kanagawapm/followers')
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(
      '/login?to=%2F%40kanagawapm%2Ffollowers',
    )
    const json = await send(
      '/communities/follows',
      { handle: 'kanagawapm', back: '/@kanagawapm' },
      '',
      'application/json',
    )
    expect(json.status).toBe(401)
    expect(await orm.select().from(communityFollows)).toEqual([])
  })

  test('F31-AC2: Given a form from another site, When it is sent, Then nothing is stored', async () => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}/communities/follows`, {
        method: 'POST',
        headers: {
          Cookie: bob,
          Origin: 'https://evil.example',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ handle: 'kanagawapm' }).toString(),
      }),
      env,
    )
    expect(response.status).toBe(403)
    expect(await followers()).toEqual([])
  })
})

describe('followers', () => {
  test('F31-AC10: Given people who follow, When the followers tab opens, Then they stand newest follow first and the tab counts them', async () => {
    await followCommunity(db, { userId: BOB, communityId: ID, now: 10 })
    await followCommunity(db, { userId: CAROL, communityId: ID, now: 20 })
    const page = await flat(await open('/@kanagawapm/followers', bob))
    expect(page).toContain(
      '<a href="/@kanagawapm/followers" aria-current="page" >フォロワー <span class="count">2</span></a >',
    )
    expect(page.indexOf('href="/@carol"')).toBeGreaterThan(-1)
    expect(page.indexOf('href="/@carol"')).toBeLessThan(
      page.indexOf('href="/@bob"'),
    )
    // Each row follows the person, and comes back to the tab.
    expect(page).toContain('aria-label="@carol さんをフォローする"')
    expect(page).toContain('value="/@kanagawapm/followers"')
    // The reader's own row has no button.
    expect(page).not.toContain('aria-label="@bob さんをフォローする"')
    // The other tabs carry the count too, and the head has none.
    expect(await flat(await open('/@kanagawapm'))).toContain(
      'フォロワー <span class="count">2</span>',
    )
  })

  test('F31-AC10: Given nobody follows, When the followers tab opens, Then it says so and counts 0', async () => {
    const page = await flat(await open('/@kanagawapm/followers'))
    expect(page).toContain('フォロワー <span class="count">0</span>')
    expect(page).toContain('フォロワーはまだいません。')
  })

  test('F31-AC10: Given a reader who is not signed in, When the followers tab opens, Then a row’s button opens the sign-in prompt for following people', async () => {
    await followCommunity(db, { userId: CAROL, communityId: ID, now: 10 })
    const page = await flat(await open('/@kanagawapm/followers'))
    expect(page).toContain('<template data-login-prompt-for="follow">')
    expect(page).toContain('data-login-prompt="follow"')
  })

  test('F31-AC10: Given a follower the reader muted, a suspended one and one who left, When the tab opens, Then none of them is listed or counted', async () => {
    await followCommunity(db, { userId: BOB, communityId: ID, now: 10 })
    await followCommunity(db, { userId: CAROL, communityId: ID, now: 20 })
    await mute(db, { muter: OWNER_ID, muted: CAROL, now: 30 })
    const muted = await flat(await open('/@kanagawapm/followers', owner))
    expect(muted).toContain('フォロワー <span class="count">1</span>')
    expect(muted).not.toContain('href="/@carol"')

    await orm.insert(suspensions).values({
      user_id: BOB,
      reason: 'spam',
      suspended_at: 1,
      suspended_by: 'operator',
    })
    const page = await flat(await open('/@kanagawapm/followers'))
    expect(page).toContain('フォロワー <span class="count">1</span>')
    expect(page).not.toContain('href="/@bob"')
  })

  test('F31-AC10: Given a page number past the end or not a number, When the tab opens, Then the end says nobody is there and a bad number is not a page', async () => {
    await followCommunity(db, { userId: BOB, communityId: ID, now: 10 })
    const past = await flat(await open('/@kanagawapm/followers?page=2'))
    expect(past).toContain('このページには、だれもいません。')
    expect((await open('/@kanagawapm/followers?page=x')).status).toBe(404)
    expect((await open('/@kanagawapm/followers?page=0')).status).toBe(404)
  })
})

describe('what does not change a follow', () => {
  test('F31-AC11, F20-AC14: Given a follower of the community and of the author, When a slide comes into it and the community is followed, Then only the author’s follower is told', async () => {
    await follow(carol)
    await orm.insert(follows).values({
      follower_user_id: BOB,
      followee_user_id: OWNER_ID,
      created_at: 1,
    })
    await seedPublic(db, 'talk', 100, 'Talk')
    await seedTalkLink(db, {
      deckId: 'talk',
      url: 'https://kanagawapm.connpass.com/event/1/',
    })
    await notifyFolloweePublished(db, { deckId: 'talk', now: 200 })

    const told = await orm
      .select({ to: notifications.recipient_user_id, kind: notifications.kind })
      .from(notifications)
    expect(told).toEqual([{ to: BOB, kind: 'followee_published' }])
  })

  test('F31-AC12, F32-AC17: Given people who follow the community, When one blocks the other either way, Then both keep following and the blocked one may still follow', async () => {
    await follow(bob)
    await follow(carol)
    await block(db, { blocker: BOB, blocked: CAROL, now: 30 })
    await block(db, { blocker: OWNER_ID, blocked: BOB, now: 30 })
    expect(await followers()).toEqual([BOB, CAROL])

    await release(bob)
    await follow(bob)
    expect(await followers()).toEqual([BOB, CAROL])
  })

  test('F31-AC13: Given a community with followers, When it is deleted, Then its follows go and another community’s stay', async () => {
    await seedCommunity(db, {
      id: 70,
      handle: 'hono',
      links: ['https://hono.connpass.com/'],
    })
    await follow(bob)
    await follow(bob, '/@hono', 'hono')
    expect(
      await deleteCommunity(
        { database: db, bucket: platform.env.UPLOADS },
        { communityId: ID, now: 100 },
      ),
    ).toBe(true)
    expect(await followers()).toEqual([])
    expect(await followers(70)).toEqual([BOB])
  })

  test('F31-AC15: Given a person who follows communities, When they leave, Then their follows go and others’ stay', async () => {
    await follow(bob)
    await follow(carol)
    await markAccountDeleted(db, { ownerUserId: BOB, now: 100 })
    expect(await followers()).toEqual([CAROL])
  })
})
