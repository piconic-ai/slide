import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import {
  blocks,
  communities,
  communityAdmins,
  communityFollows,
  handles,
  mutes,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
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

const BOB = '2'
let owner = ''
let bob = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetCommunities(db)
  owner = await signIn(env)
  bob = await signIn(env, 'bob', { id: BOB })
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
const post = (
  path: string,
  fields: ReadonlyArray<readonly [string, string]>,
  cookie = owner,
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields.map(([k, v]) => [k, v])).toString(),
    }),
    env,
  )
const make = (
  handle: string,
  links: readonly string[],
  extra: ReadonlyArray<readonly [string, string]> = [],
  cookie = owner,
  name = 'Kanagawa.pm',
) =>
  post(
    '/communities/new',
    [
      ['handle', handle],
      ['name', name],
      ...links.map((link) => ['link', link] as const),
      ...extra,
    ],
    cookie,
  )
const errorUnder = (body: string, field: string) =>
  new RegExp(`aria-invalid="true" aria-describedby="${field}-error`).test(body)

describe('making a community', () => {
  test('F30-AC9: Given a signed-in person, When they make a community, Then they go to its page and run it', async () => {
    const response = await make('kanagawapm', [
      'https://kanagawapm.connpass.com/',
    ])
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/@kanagawapm')
    const [community] = await orm.select().from(communities)
    expect(community).toMatchObject({ name: 'Kanagawa.pm' })
    expect(await orm.select().from(communityAdmins)).toEqual([
      {
        community_id: community!.id,
        user_id: OWNER_ID,
        added_at: expect.any(Number),
      },
    ])
    const page = await open('/@kanagawapm', owner)
    expect(page.status).toBe(200)
    expect(await flat(page)).toContain('href="/@kanagawapm/edit"')
  })

  test('F31-AC17: Given a signed-in person, When they make a community, Then its page says they follow it and its followers tab lists them', async () => {
    await make('kanagawapm', ['https://kanagawapm.connpass.com/'])
    const page = await flat(await open('/@kanagawapm', owner))
    expect(page).toContain('aria-label="Kanagawa.pm のフォローを解除する"')
    expect(page).toContain('<span class="state">フォロー中</span')
    const followers = await flat(await open('/@kanagawapm/followers', bob))
    expect(followers).toContain('フォロワー <span class="count">1</span>')
    expect(followers).toContain('href="/@owner"')
  })

  test('F31-AC17: Given a handle a person holds, When a community is made with it, Then no follow is left behind', async () => {
    const refused = await make('bob', ['https://kanagawapm.connpass.com/'])
    expect(refused.status).toBe(409)
    expect(await orm.select().from(communityFollows)).toEqual([])
  })

  test('F30-AC10: Given someone not signed in, When they open the page or send the form, Then they go to sign in and nothing is made', async () => {
    const page = await open('/communities/new')
    expect(page.status).toBe(303)
    expect(page.headers.get('Location')).toBe('/login?to=%2Fcommunities%2Fnew')
    const fromEvent = await open(
      '/communities/new?link=https%3A%2F%2Fkanagawapm.connpass.com%2F',
    )
    expect(fromEvent.headers.get('Location')).toBe(
      `/login?to=${encodeURIComponent('/communities/new?link=https%3A%2F%2Fkanagawapm.connpass.com%2F')}`,
    )
    const sent = await make(
      'kanagawapm',
      ['https://kanagawapm.connpass.com/'],
      [],
      '',
    )
    expect(sent.status).toBe(401)
    expect(await orm.select().from(communities)).toEqual([])
  })

  test('F30-AC10: Given a form sent from another site, When it arrives, Then it is refused', async () => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}/communities/new`, {
        method: 'POST',
        headers: {
          Cookie: owner,
          Origin: 'https://evil.example',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'handle=x&name=x&link=https%3A%2F%2Fx.connpass.com%2F',
      }),
      env,
    )
    expect(response.status).toBe(403)
    expect(await orm.select().from(communities)).toEqual([])
  })

  test('F30-AC1: Given a handle a person holds, When a community is made with it, Then the reason shows under the handle', async () => {
    const response = await make('bob', ['https://bob.connpass.com/'])
    expect(response.status).toBe(409)
    const body = await flat(response)
    expect(errorUnder(body, 'community-handle')).toBe(true)
    expect(body).toContain('このハンドルは、すでに使われています。')
    expect(body).toContain('value="https://bob.connpass.com/"')
  })

  test.each([
    ['https://connpass.com/', 'だれでも使うサイトのリンクは入れられません。'],
    [
      'https://kanagawapm.connpass.com/event/1/',
      'グループやサイトのトップの URL',
    ],
    [
      'https://luma.com/kanagawa',
      'Luma は、カレンダーの「iCal で購読」の URL を入れてください。',
    ],
  ])(
    'F30-AC11: F30-AC12: F30-AC39: Given the link %s, When the form is sent, Then the field is marked, the reason shows under it, and what was typed stays',
    async (link, reason) => {
      const response = await make('kanagawapm', ['https://kanagawa.pm/', link])
      expect(response.status).toBe(400)
      const body = await flat(response)
      expect(body).toContain(reason)
      expect(body).toContain(
        'aria-invalid="true" aria-describedby="community-link-1-error"',
      )
      expect(body).not.toContain('aria-describedby="community-link-0-error"')
      expect(body).toContain(`value="${link}"`)
      expect(body).toContain('value="kanagawapm"')
      expect(await orm.select().from(communities)).toEqual([])
    },
  )

  test('F30-AC13: Given a link another community holds, When the form is sent, Then the field says which community uses it, linking to it, and nothing is made', async () => {
    await seedCommunity(db, {
      id: 9,
      handle: 'hono',
      links: ['https://hono.connpass.com/'],
    })
    const response = await make('kanagawapm', [
      'https://kanagawapm.connpass.com/',
      'https://hono.connpass.com/',
    ])
    expect(response.status).toBe(409)
    const body = await flat(response)
    expect(body).toMatch(
      /このリンクは <a href="\/@hono" >slide.community\/@hono<\/a > がすでに使っています。/,
    )
    expect(body).toContain('aria-describedby="community-link-1-error"')
    expect(
      await orm.select().from(handles).where(eq(handles.handle, 'kanagawapm')),
    ).toEqual([])
  })

  test('F30-AC17: Given eleven links, When the form is sent, Then it is refused with the reason', async () => {
    const links = Array.from(
      { length: 11 },
      (_, i) => `https://g${i}.connpass.com/`,
    )
    const response = await make('kanagawapm', links)
    expect(response.status).toBe(400)
    expect(await flat(response)).toContain('紐づけ用リンクは 10 個までです。')
    expect(await orm.select().from(communities)).toEqual([])
  })

  test('F30-AC39: Given the form, When "add a link" and "remove" are pressed, Then rows are added and removed up to ten, what was typed kept, nothing made', async () => {
    const added = await flat(
      await make('kanagawapm', ['https://a.connpass.com/'], [['add', 'link']]),
    )
    expect(added.match(/name="link"/g)).toHaveLength(2)
    expect(added).toContain('value="https://a.connpass.com/"')
    const removed = await flat(
      await make(
        'kanagawapm',
        ['https://a.connpass.com/', 'https://b.connpass.com/'],
        [['remove', '0']],
      ),
    )
    expect(removed.match(/name="link"/g)).toHaveLength(1)
    expect(removed).toContain('value="https://b.connpass.com/"')
    const ten = Array.from(
      { length: 10 },
      (_, i) => `https://g${i}.connpass.com/`,
    )
    const full = await flat(await make('kanagawapm', ten, [['add', 'link']]))
    expect(full.match(/name="link"/g)).toHaveLength(10)
    expect(full).not.toContain('name="add"')
    expect(await orm.select().from(communities)).toEqual([])
  })

  test('F30-AC37: Given a name over 50 characters, When the form is sent, Then the reason shows; HTML in a name stays text', async () => {
    const long = await make(
      'kanagawapm',
      ['https://kanagawapm.connpass.com/'],
      [],
      owner,
      'あ'.repeat(51),
    )
    expect(long.status).toBe(400)
    expect(await flat(long)).toContain('名前は 50 文字までです。')
    await make(
      'kanagawapm',
      ['https://kanagawapm.connpass.com/'],
      [],
      owner,
      '<script>x</script>',
    )
    const page = await flat(await open('/@kanagawapm'))
    expect(page).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(page).not.toContain('<script>x</script>')
  })

  test('F30-AC40: Given the way from an event page, When the page opens, Then the first link holds the group', async () => {
    const body = await flat(
      await open(
        '/communities/new?link=https%3A%2F%2Fkanagawapm.connpass.com%2F',
        owner,
      ),
    )
    expect(body).toContain('name="link" type="url"')
    expect(body).toMatch(
      /name="link"[^>]*value="https:\/\/kanagawapm.connpass.com\/"/,
    )
  })
})

describe("a community's page", () => {
  const KANAGAWA = 'https://kanagawapm.connpass.com/event/'
  const seedEvents = async () => {
    await seedCommunity(db, {
      id: 5,
      handle: 'kanagawapm',
      name: 'Kanagawa.pm',
      links: ['https://kanagawapm.connpass.com/'],
    })
    // Event 1: eight talks; event 2, newer: one talk by bob.
    for (let i = 0; i < 8; i++) {
      await seedPublic(db, `one-${i}`, 100 + i, `One ${i}`)
      await seedTalkLink(db, {
        deckId: `one-${i}`,
        url: `${KANAGAWA}1/`,
        title: 'Kanagawa.pm #1',
      })
    }
    await seedPublic(db, 'two', 500, 'Two', BOB)
    await seedTalkLink(db, {
      deckId: 'two',
      url: `${KANAGAWA}2/`,
      owner: BOB,
      title: 'Kanagawa.pm #2',
    })
  }

  test('F30-AC18: Given a community, When its page opens, Then the cover, the head and the tabs come in order, and no count stands in the head', async () => {
    await seedEvents()
    const body = await flat(await open('/@kanagawapm'))
    const at = (needle: string) => body.indexOf(needle)
    expect(at('class="cover-pattern"')).toBeGreaterThan(-1)
    expect(at('class="cover-pattern"')).toBeLessThan(
      at('class="community-logo'),
    )
    expect(at('class="community-logo')).toBeLessThan(at('<h1>Kanagawa.pm</h1>'))
    expect(at('<h1>Kanagawa.pm</h1>')).toBeLessThan(at('@kanagawapm</li>'))
    expect(at('@kanagawapm</li>')).toBeLessThan(
      at('kanagawapm.connpass.com</a>'),
    )
    expect(at('kanagawapm.connpass.com</a>')).toBeLessThan(
      at('class="profile-tabs"'),
    )
    const head = body.slice(
      at('class="profile-head'),
      at('class="profile-tabs"'),
    )
    expect(head).not.toMatch(/class="count"/)
    expect(body).toMatch(/イベント <span class="count">2<\/span>/)
    expect(body).toMatch(/スライド <span class="count">9<\/span>/)
    // Its maker follows it from the start (F31-AC17).
    expect(body).toMatch(/フォロワー <span class="count">1<\/span>/)
    // Not an admin: no way to edit.
    expect(body).not.toContain('/@kanagawapm/edit')
  })

  test('F30-AC19: Given events with talks, When the events tab opens, Then the newest event comes first, each shows its count, six slides and "n more" to its page', async () => {
    await seedEvents()
    const body = await flat(await open('/@kanagawapm'))
    expect(body.indexOf('Kanagawa.pm #2')).toBeLessThan(
      body.indexOf('Kanagawa.pm #1'),
    )
    expect(body).toContain('スライド 8 本')
    expect(body).toContain('スライド 1 本')
    const one = body.slice(body.indexOf('Kanagawa.pm #1'))
    expect(one.match(/class="deck-card"/g)).toHaveLength(6)
    expect(one).toMatch(
      /<li class="carousel-more"> ?<a href="\/link\/connpass\.com\/event\/1" ?>ほか 2 本<\/a ?> ?<\/li>/,
    )
    // The heading leads to the same page of links (F45).
    expect(body).toMatch(
      /<h2> ?<a href="\/link\/connpass\.com\/event\/1" ?>Kanagawa\.pm #1<\/a>/,
    )
    expect(one.indexOf('One 7')).toBeLessThan(one.indexOf('One 2'))
    expect(one).not.toContain('One 1<')
    expect(body).toMatch(
      /role="region" aria-label="Kanagawa.pm #1 のスライド" tabindex="0"/,
    )
  })

  test('F30-AC21: Given talks, When the slides tab opens, Then every public talk comes once, newest first', async () => {
    await seedEvents()
    const body = await flat(await open('/@kanagawapm/slides'))
    expect(body.match(/class="deck-card"/g)).toHaveLength(9)
    expect(body.indexOf('Two')).toBeLessThan(body.indexOf('One 7'))
    expect(body).toContain('aria-current="page" >スライド')
  })

  test('F30-AC38: F32-AC4: Given a reader who blocked bob, When they open the community, Then bob’s talk is in neither list nor count; someone else still sees it', async () => {
    await seedEvents()
    await orm.insert(blocks).values({
      blocker_user_id: OWNER_ID,
      blocked_user_id: BOB,
      created_at: 1,
    })
    const events = await flat(await open('/@kanagawapm', owner))
    expect(events).not.toContain('Kanagawa.pm #2')
    expect(events).toMatch(/イベント <span class="count">1<\/span>/)
    const slides = await flat(await open('/@kanagawapm/slides', owner))
    expect(slides).not.toContain('Two')
    expect(slides).toMatch(/スライド <span class="count">8<\/span>/)
    expect(await flat(await open('/@kanagawapm/slides'))).toContain('Two')
  })

  test('Given a reader who muted bob, When they open the community, Then bob’s talk is left out too', async () => {
    await seedEvents()
    await orm
      .insert(mutes)
      .values({ muter_user_id: OWNER_ID, muted_user_id: BOB, created_at: 1 })
    expect(await flat(await open('/@kanagawapm/slides', owner))).not.toContain(
      'Two',
    )
  })

  test('F30-AC22: Given a community, When its page opens twice, Then the cover is the same both times, in its color', async () => {
    await seedEvents()
    const [community] = await orm.select().from(communities)
    const cover = async () =>
      (await flat(await open('/@kanagawapm'))).match(
        /<div class="cover-pattern".*?<\/div>/,
      )?.[0]
    const first = await cover()
    expect(first).toContain(`var(--community-${community!.color}`)
    // F30-AC23: the pattern is one image, named as the cover.
    expect(first).toContain('role="img" aria-label="Kanagawa.pm のカバー画像"')
    expect(first?.match(/<span/g)).toHaveLength(32)
    expect(await cover()).toBe(first)
  })

  test('F30-AC22: Given communities made through the form, When their colors are read, Then each is one of the five', async () => {
    for (let i = 0; i < 6; i++)
      await make(`c${i}`, [`https://c${i}.connpass.com/`])
    const colors = (await orm.select().from(communities)).map(
      (row) => row.color,
    )
    expect(colors).toHaveLength(6)
    for (const color of colors)
      expect(['red', 'orange', 'yellow', 'green', 'navy']).toContain(color)
  })

  test('Given a path under a community that is not one of its pages, When it opens, Then it is not found', async () => {
    await seedEvents()
    expect((await open('/@kanagawapm/some-slide')).status).toBe(404)
    expect((await open('/@kanagawapm/following')).status).toBe(404)
    expect((await open('/@kanagawapm/followers')).status).toBe(200)
  })
})
