import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { applySuspensionCommand } from '../publication/suspension-store'
import {
  OWNER_ID,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { addCommunityAdmin } from './admin-store'
import type { Handle } from '../share/handle'
import { resetCommunities, seedCommunity } from './test-communities'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = testEnv(platform.env)

let owner = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetCommunities(db)
  owner = await signIn(env, 'owner')
  // Bob runs communities of his own.
  await signIn(env, 'bob', { id: '2' })
})
afterAll(() => platform.dispose())

const open = (path: string, cookie = '') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )

const flat = async (response: Response) =>
  (await response.text()).replace(/\s+/g, ' ')

/** What stands between the page's <main> and </main>. */
const mainOf = (body: string) =>
  body.slice(body.indexOf('<main'), body.indexOf('</main>'))

const seedThree = async () => {
  await seedCommunity(db, {
    id: 1,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
  await seedCommunity(db, {
    id: 2,
    handle: 'hono',
    name: '<b>Hono</b> & co',
    links: ['https://hono.connpass.com/'],
    creator: OWNER_ID,
  })
  // Bob made it and added the owner as an admin.
  await seedCommunity(db, {
    id: 3,
    handle: 'yapc',
    name: 'YAPC',
    links: ['https://yapc.connpass.com/'],
    creator: '2',
  })
  await addCommunityAdmin(db, {
    communityId: 3,
    handle: 'owner' as Handle,
    now: 2000,
  })
  // Only Bob runs this one.
  await seedCommunity(db, {
    id: 4,
    handle: 'bobs',
    name: 'Bob’s meetup',
    links: ['https://bobs.connpass.com/'],
    creator: '2',
  })
}

test('F30-AC60: Given communities a person made or was added to, When /communities/manage opens, Then the heading, the way to make one and a row per community follow in that order, by name, each with its logo, name, handle and "edit"', async () => {
  await seedThree()
  const response = await open('/communities/manage', owner)
  expect(response.status).toBe(200)
  const body = await flat(response)
  expect(body).toContain('<title>コミュニティの管理')
  const main = mainOf(body)
  const order = [
    '<h1>コミュニティの管理</h1>',
    'href="/communities/new">コミュニティを作る</a>',
    '<ul class="deck-rows" aria-label="コミュニティの一覧">',
  ].map((part) => main.indexOf(part))
  expect(order.every((at) => at >= 0)).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  // One row each, by name; the name is text, not markup.
  const names = [
    ...main.matchAll(
      /<p class="deck-row-name"><a href="([^"]+)">([^<]*)<\/a>/g,
    ),
  ]
  expect(names.map(([, href, name]) => [href, name])).toEqual([
    ['/@hono', '&lt;b&gt;Hono&lt;/b&gt; &amp; co'],
    ['/@kanagawapm', 'Kanagawa.pm'],
    ['/@yapc', 'YAPC'],
  ])
  expect(main).toContain('<p class="card-meta">@kanagawapm</p>')
  expect(main).toContain(
    'href="/@kanagawapm/edit" aria-label="Kanagawa.pm を編集する" >編集する</a >',
  )
  expect(main).toContain('href="/@yapc/edit"')
  // The logo is the initial on the community's color, hidden from readers.
  expect(main).toContain(
    '<a class="deck-row-cover" href="/@kanagawapm" tabindex="-1" aria-hidden="true" ><span class="community-logo community-logo-48"',
  )
  // One Bob alone runs is not listed.
  expect(main).not.toContain('/@bobs')
})

test('F30-AC60: Given the page in English, When it opens, Then it is "Your communities" with the same parts', async () => {
  await seedThree()
  const body = await flat(await open('/communities/manage?lang=en', owner))
  expect(body).toContain('<h1>Your communities</h1>')
  expect(body).toContain('href="/communities/new">Create a community</a>')
  expect(body).toContain('aria-label="Edit Kanagawa.pm" >Edit</a >')
})

test('F30-AC61: Given a person who runs no community, When /communities/manage opens, Then only the heading and the way to make one are shown, as the slide list does with no slide', async () => {
  await seedCommunity(db, {
    id: 4,
    handle: 'bobs',
    name: 'Bob’s meetup',
    links: ['https://bobs.connpass.com/'],
    creator: '2',
  })
  const response = await open('/communities/manage', owner)
  expect(response.status).toBe(200)
  const main = mainOf(await flat(response))
  expect(main).toContain('<h1>コミュニティの管理</h1>')
  expect(main).toContain('href="/communities/new"')
  expect(main).not.toContain('<ul')
  expect(main).not.toContain('/@bobs')
})

test('F30-AC62: Given a visitor who is not signed in, When /communities/manage opens, Then the same sign-in page as the slide list answers, its button coming back here', async () => {
  await seedThree()
  const [manage, slides] = await Promise.all([
    open('/communities/manage'),
    open('/my/slides'),
  ])
  expect(manage.status).toBe(401)
  expect(slides.status).toBe(401)
  const body = mainOf(await flat(manage))
  expect(body).toContain('href="/login?to=%2Fcommunities%2Fmanage"')
  expect(body).not.toContain('/@kanagawapm')
  // The slide list's sign-in page but for where it returns to.
  expect(body.replace('?to=%2Fcommunities%2Fmanage', '')).toBe(
    mainOf(await flat(slides)),
  )
})

test('F30-AC62: Given a suspended person who runs communities, When /communities/manage opens, Then the same suspended page as the slide list answers', async () => {
  await seedThree()
  await applySuspensionCommand(db, {
    userId: OWNER_ID,
    command: { kind: 'suspend', reason: 'abuse', operator: 'op@example.com' },
    now: 1000,
  })
  const [manage, slides] = await Promise.all([
    open('/communities/manage', owner),
    open('/my/slides', owner),
  ])
  expect(manage.status).toBe(403)
  expect(slides.status).toBe(403)
  const body = await manage.text()
  expect(body).toContain('アカウントは停止中です')
  expect(body).not.toContain('/@kanagawapm')
})

test('F30-AC60: Given a person who runs communities, When their settings open, Then no frame lists them there', async () => {
  await seedThree()
  const body = await flat(await open('/settings', owner))
  expect(body).not.toContain('管理しているコミュニティ')
  expect(body).not.toContain('/@kanagawapm/edit')
})
