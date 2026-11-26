import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { block } from '../blocks/store'
import {
  addCommunityAdmin,
  deleteCommunity,
  removeCommunityAdmin,
} from '../communities/admin-store'
import { followCommunity, unfollowCommunity } from '../communities/follow-store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from '../communities/test-communities'
import { applyMigrations } from '../db/test-migrations'
import type { Handle } from '../share/handle'
import {
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

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
    now: 1,
  })
  // Carol makes Hono Conf, so she runs and follows it from 5, then
  // follows Kanagawa.pm at 10.
  await seedCommunity(db, {
    id: HONO,
    handle: 'hono',
    name: 'Hono Conf',
    links: ['https://hono.connpass.com/'],
    creator: CAROL,
    now: 5,
  })
  await followCommunity(db, { userId: CAROL, communityId: HONO, now: 5 })
  await followCommunity(db, { userId: CAROL, communityId: KANAGAWA, now: 10 })
})
afterAll(() => platform.dispose())

async function seedTalk(
  slug: string,
  readyAt: number,
  owner = OWNER_ID,
  group = 'kanagawapm',
) {
  await seedPublic(db, slug, readyAt, slug, owner)
  await seedTalkLink(db, {
    deckId: slug,
    owner,
    url: `https://${group}.connpass.com/event/${readyAt}/`,
  })
}

const open = async (path: string, cookie = '') => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )
  return {
    status: response.status,
    page: (await response.text()).replace(/\s+/g, ' ').replace(/ >/g, '>'),
  }
}
/** The part of the page that one community's row holds. */
const rowOf = (page: string, handle: string) => {
  const start = page.indexOf(`<a href="/@${handle}">`)
  const end = page.indexOf('<li class="followed-community">', start)
  return page.slice(start, end === -1 ? undefined : end)
}

describe('the communities tab of a profile', () => {
  test('F31-AC8: Given an author who follows one community and runs and follows another, When the tab opens, Then each stands once, the newest follow first, each with its logo, name and the reader’s follow button, and the tab counts them', async () => {
    await followCommunity(db, { userId: BOB, communityId: KANAGAWA, now: 30 })
    const { status, page } = await open('/@carol/communities', bob)
    expect(status).toBe(200)
    expect(page).toContain(
      'href="/@carol/communities" aria-current="page">コミュニティ <span class="count">2</span>',
    )
    expect(page).toContain('<h2>フォロー・管理しているコミュニティ</h2>')
    expect(page.indexOf('href="/@kanagawapm"')).toBeLessThan(
      page.indexOf('href="/@hono"'),
    )
    expect(page.match(/community-logo community-logo-48/g)).toHaveLength(2)
    expect(page.match(/href="\/@hono"/g)).toHaveLength(1)
    // The reader follows Kanagawa.pm, not Hono Conf.
    expect(rowOf(page, 'kanagawapm')).toContain(
      'aria-label="Kanagawa.pm のフォローを解除する"',
    )
    expect(rowOf(page, 'hono')).toContain(
      'aria-label="Hono Conf をフォローする"',
    )
    expect(page).toContain('name="back" value="/@carol/communities"')
    // No count of followers or events.
    expect(page).not.toContain('フォロワー数')
    expect(page).not.toMatch(/イベント \d/)
  })

  test('F31-AC8, D-53: Given five public slides in a community and one outside it, When the tab opens, Then the four newest public ones stand, newest first', async () => {
    for (let n = 1; n <= 5; n += 1) await seedTalk(`talk-${n}`, n * 10)
    await seedPublic(db, 'draft', 100, 'draft')
    const { page } = await open('/@carol/communities')
    const talks = [
      ...rowOf(page, 'kanagawapm').matchAll(/href="\/@owner\/([a-z0-9-]+)"/g),
    ].map((match) => match[1])
    expect(talks).toEqual(['talk-5', 'talk-4', 'talk-3', 'talk-2'])
    expect(page).toContain('aria-label="Kanagawa.pm の最近のスライド"')
    // A community with no slide has no grid.
    expect(page).not.toContain('aria-label="Hono Conf の最近のスライド"')
  })

  test('F31-AC8, F32-AC4: Given the reader blocked an author, When the tab opens, Then that author’s slides leave the recent ones', async () => {
    await seedTalk('owners', 10)
    await seedTalk('bobs', 20, BOB)
    await block(db, { blocker: CAROL, blocked: OWNER_ID, now: 30 })
    const carol = await signIn(env, 'carol', { id: CAROL })
    const { page } = await open('/@carol/communities', carol)
    expect(page).toContain('href="/@bob/bobs"')
    expect(page).not.toContain('href="/@owner/owners"')
    expect((await open('/@carol/communities', bob)).page).toContain(
      'href="/@owner/owners"',
    )
  })

  test('F31-AC18, F32-AC4: Given a community the author runs but does not follow, When a reader who blocked an author opens the tab, Then that author’s slides leave its recent ones too', async () => {
    await unfollowCommunity(db, { userId: CAROL, communityId: HONO })
    await seedTalk('owners', 10, OWNER_ID, 'hono')
    await seedTalk('bobs', 20, BOB, 'hono')
    await block(db, { blocker: BOB, blocked: OWNER_ID, now: 30 })
    const hono = rowOf((await open('/@carol/communities', bob)).page, 'hono')
    expect(hono).toContain('href="/@bob/bobs"')
    expect(hono).not.toContain('href="/@owner/owners"')
  })

  test('F31-AC18: Given the author stops following a community they run, When the tab opens, Then it stays with the key and the count stays; once they stop running it too, it leaves both', async () => {
    await unfollowCommunity(db, { userId: CAROL, communityId: HONO })
    const running = (await open('/@carol/communities')).page
    expect(running).toContain('コミュニティ <span class="count">2</span>')
    expect(rowOf(running, 'hono')).toContain(
      '<span class="visually-hidden">管理者</span>',
    )
    await addCommunityAdmin(db, {
      communityId: HONO,
      handle: 'bob' as Handle,
      now: 40,
    })
    expect(
      await removeCommunityAdmin(db, { communityId: HONO, userId: CAROL }),
    ).toBe('removed')
    const left = (await open('/@carol/communities')).page
    expect(left).toContain('コミュニティ <span class="count">1</span>')
    expect(left).not.toContain('href="/@hono"')
    // Bob, added as an admin, runs it without following it.
    const bobs = (await open('/@bob/communities')).page
    expect(bobs).toContain('コミュニティ <span class="count">1</span>')
    expect(rowOf(bobs, 'hono')).toContain(
      '<span class="visually-hidden">管理者</span>',
    )
    expect(rowOf(bobs, 'hono')).toContain(
      'aria-label="Hono Conf をフォローする"',
    )
  })

  test('F31-AC8: Given follows and admin roles at different times, When the tab opens, Then the later of each community’s follow and admin role orders it, newest first', async () => {
    // Hono Conf: run and followed from 5. Kanagawa.pm: followed at 10.
    // Bob's PHP community: Carol is made its admin at 20, never follows it.
    await seedCommunity(db, {
      id: 80,
      handle: 'phpcon',
      links: ['https://phpcon.connpass.com/'],
      creator: BOB,
      now: 2,
    })
    await addCommunityAdmin(db, {
      communityId: 80,
      handle: 'carol' as Handle,
      now: 20,
    })
    const order = (page: string) =>
      ['hono', 'kanagawapm', 'phpcon'].sort(
        (a, b) => page.indexOf(`href="/@${a}"`) - page.indexOf(`href="/@${b}"`),
      )
    expect(order((await open('/@carol/communities')).page)).toEqual([
      'phpcon',
      'kanagawapm',
      'hono',
    ])
    // Following Hono Conf again keeps its first follow, at 5; being made
    // an admin of Kanagawa.pm at 30 brings it to the top.
    await followCommunity(db, { userId: CAROL, communityId: HONO, now: 25 })
    await addCommunityAdmin(db, {
      communityId: KANAGAWA,
      handle: 'carol' as Handle,
      now: 30,
    })
    expect(order((await open('/@carol/communities')).page)).toEqual([
      'kanagawapm',
      'phpcon',
      'hono',
    ])
  })

  test('F31-AC8: Given an author who follows or runs 52 communities, When the pages open, Then 50 stand on the first and the other 2 on the next, none twice, and the tab counts 52', async () => {
    // Carol makes 26 more (run and followed) and follows 24 Bob makes.
    for (let n = 0; n < 50; n += 1)
      await seedCommunity(db, {
        id: 100 + n,
        handle: `group${n}`,
        links: [`https://group${n}.connpass.com/`],
        creator: n < 26 ? CAROL : BOB,
        now: 100 + n,
      })
    for (let n = 26; n < 50; n += 1)
      await followCommunity(db, {
        userId: CAROL,
        communityId: 100 + n,
        now: 200 + n,
      })
    const handlesOn = (page: string) =>
      [
        ...page.matchAll(
          /<span class="followed-community-name"><a href="\/@([a-z0-9]+)">/g,
        ),
      ].map((match) => match[1])
    const first = (await open('/@carol/communities')).page
    const second = (await open('/@carol/communities?page=2')).page
    expect(first).toContain('コミュニティ <span class="count">52</span>')
    expect(handlesOn(first)).toHaveLength(50)
    expect(handlesOn(first)[0]).toBe('group49')
    expect(handlesOn(second)).toEqual(['kanagawapm', 'hono'])
    expect(new Set([...handlesOn(first), ...handlesOn(second)]).size).toBe(52)
    expect(first).toContain('href="/@carol/communities?page=2"')
  })

  test('F30-AC34: Given the author runs one of the communities, When the tab opens, Then only that name has the key, read out as admin', async () => {
    const { page } = await open('/@carol/communities')
    expect(rowOf(page, 'hono')).toContain(
      '<span class="visually-hidden">管理者</span>',
    )
    expect(rowOf(page, 'kanagawapm')).not.toContain('admin-badge')
    // Bob follows Hono Conf but runs nothing.
    await followCommunity(db, { userId: BOB, communityId: HONO, now: 30 })
    const bobs = await open('/@bob/communities')
    expect(bobs.page).toContain('href="/@hono"')
    expect(bobs.page).not.toContain('<span class="visually-hidden">管理者')
  })

  test('F31-AC9: Given a reader who is not signed in, When the tab opens, Then the list shows and "follow" opens the sign-in prompt', async () => {
    const { status, page } = await open('/@carol/communities')
    expect(status).toBe(200)
    expect(page).toContain('href="/@hono"')
    expect(page).toContain('data-login-prompt="follow-community"')
    expect(page).toContain(
      '<template data-login-prompt-for="follow-community">',
    )
    expect(page).toContain('href="/login?to=%2F%40carol%2Fcommunities"')
  })

  test('F31-AC8: Given an author who follows and runs none, a page past the end and a bad page, When the tab opens, Then each says so or is not a page', async () => {
    expect((await open('/@bob/communities')).page).toContain(
      'フォロー・管理しているコミュニティは、まだありません。',
    )
    expect((await open('/@carol/communities?page=2')).page).toContain(
      'このページには、コミュニティがありません。',
    )
    expect((await open('/@carol/communities?page=x')).status).toBe(404)
  })

  test('F31-AC13: Given a followed community, When it is deleted, Then it leaves the tab and its count', async () => {
    await deleteCommunity(
      { database: db, bucket: platform.env.UPLOADS },
      { communityId: HONO, now: 100 },
    )
    const { page } = await open('/@carol/communities')
    expect(page).toContain('コミュニティ <span class="count">1</span>')
    expect(page).not.toContain('href="/@hono"')
    expect(page).toContain('href="/@kanagawapm"')
  })
})
