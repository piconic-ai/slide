import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { block } from '../blocks/store'
import { deleteCommunity } from '../communities/admin-store'
import { followCommunity } from '../communities/follow-store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from '../communities/test-communities'
import { applyMigrations } from '../db/test-migrations'
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
  })
  await seedCommunity(db, {
    id: HONO,
    handle: 'hono',
    name: 'Hono Conf',
    links: ['https://hono.connpass.com/'],
    creator: CAROL,
  })
  // Carol follows Kanagawa.pm first, then Hono Conf, which she runs.
  await followCommunity(db, { userId: CAROL, communityId: KANAGAWA, now: 10 })
  await followCommunity(db, { userId: CAROL, communityId: HONO, now: 20 })
})
afterAll(() => platform.dispose())

async function seedTalk(slug: string, readyAt: number, owner = OWNER_ID) {
  await seedPublic(db, slug, readyAt, slug, owner)
  await seedTalkLink(db, {
    deckId: slug,
    owner,
    url: `https://kanagawapm.connpass.com/event/${readyAt}/`,
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
  const end = page.indexOf('</li> <li class="followed-community">', start)
  return page.slice(start, end === -1 ? undefined : end)
}

describe('the communities tab of a profile', () => {
  test('F31-AC8, D-53: Given an author who follows two communities, When the tab opens, Then they stand newest follow first, each with its logo, name and the reader’s follow button, and the tab counts them', async () => {
    await followCommunity(db, { userId: BOB, communityId: KANAGAWA, now: 30 })
    const { status, page } = await open('/@carol/communities', bob)
    expect(status).toBe(200)
    expect(page).toContain(
      'href="/@carol/communities" aria-current="page">コミュニティ <span class="count">2</span>',
    )
    expect(page).toContain('<h2>フォローしているコミュニティ</h2>')
    expect(page.indexOf('href="/@hono"')).toBeLessThan(
      page.indexOf('href="/@kanagawapm"'),
    )
    expect(page.match(/community-logo community-logo-48/g)).toHaveLength(2)
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

  test('F30-AC34: Given the author runs one of the communities, When the tab opens, Then only that name has the key, read out as admin', async () => {
    const { page } = await open('/@carol/communities')
    expect(rowOf(page, 'hono')).toContain(
      '<span class="visually-hidden">管理者</span>',
    )
    expect(rowOf(page, 'kanagawapm')).not.toContain('admin-badge')
    const owners = await open('/@owner/communities')
    expect(owners.page).not.toContain('<span class="visually-hidden">管理者')
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

  test('F31-AC8: Given an author who follows none, a page past the end and a bad page, When the tab opens, Then each says so or is not a page', async () => {
    expect((await open('/@bob/communities')).page).toContain(
      'まだコミュニティをフォローしていません。',
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
