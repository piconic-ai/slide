import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { communities, communityAdmins, events } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { chunkTypes, png, withPngText } from '../profile/test-picture'
import {
  OWNER_ID,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { imageKey } from './image-policy'
import { listCommunityLinks } from './store'
import {
  resetCommunities,
  seedCommunity,
  seedTalkLink,
} from './test-communities'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const bucket = platform.env.UPLOADS
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

const ID = 41
let owner = ''
let bob = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetCommunities(db)
  await bucket.delete([imageKey(ID, 'logo'), imageKey(ID, 'cover')])
  owner = await signIn(env)
  bob = await signIn(env, 'bob', { id: '2' })
  await seedCommunity(db, {
    id: ID,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
    creator: OWNER_ID,
  })
})
afterAll(() => platform.dispose())

const request = (path: string, init: RequestInit = {}, cookie = owner) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      ...init,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(init.method === 'POST' ? { Origin: TEST_ORIGIN } : {}),
        ...(init.headers ?? {}),
      },
    }),
    env,
  )
const postForm = (
  path: string,
  fields: ReadonlyArray<readonly [string, string]>,
  cookie = owner,
) =>
  request(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields.map(([k, v]) => [k, v])).toString(),
    },
    cookie,
  )
const upload = (
  image: 'logo' | 'cover',
  bytes: Uint8Array,
  cookie = owner,
  name = 'picture.png',
) => {
  const form = new FormData()
  form.append(
    'image',
    new File([new Uint8Array(bytes)], name, { type: 'image/png' }),
  )
  return request(
    `/communities/${ID}/${image}`,
    { method: 'POST', body: form },
    cookie,
  )
}
const flat = async (response: Response) =>
  (await response.text()).replace(/\s+/g, ' ')
const save = (
  fields: ReadonlyArray<readonly [string, string]>,
  cookie = owner,
) => postForm(`/communities/${ID}/edit`, fields, cookie)
const fullForm = (over: Record<string, string> = {}) =>
  [
    ['name', over.name ?? 'Kanagawa.pm 2'],
    ['description', over.description ?? 'Perl の勉強会'],
    ['link', over.link ?? 'https://kanagawapm.connpass.com/'],
    ['site', over.site ?? 'https://kanagawa.pm/'],
    ['site', ''],
    ['site', ''],
  ] as const

describe('the editing page', () => {
  test('F30-AC25: Given an admin, When they save the name, description, other links and links, Then the community shows them', async () => {
    const response = await save([
      ['name', 'Kanagawa.pm 2'],
      ['description', 'Perl の勉強会 https://example.com/'],
      ['link', 'https://kanagawapm.connpass.com/'],
      ['link', 'https://kanagawa.doorkeeper.jp/'],
      ['site', 'https://kanagawa.pm/'],
      ['site', 'https://x.com/kanagawapm'],
      ['site', ''],
    ])
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe(
      '/@kanagawapm/edit?notice=saved',
    )
    const page = await flat(await request('/@kanagawapm'))
    expect(page).toContain('<h1>Kanagawa.pm 2</h1>')
    // The description stays plain text: its address is no link (F30-AC37).
    expect(page).toContain('Perl の勉強会 https://example.com/</p>')
    expect(page).not.toContain('href="https://example.com/"')
    expect(page).toContain('href="https://x.com/kanagawapm"')
    expect((await listCommunityLinks(db, ID)).map((l) => l.url)).toEqual([
      'https://kanagawapm.connpass.com/',
      'https://kanagawa.doorkeeper.jp/',
    ])
  })

  test('F30-AC25: Given four other links, When saved, Then the fourth is refused and nothing changes', async () => {
    const response = await save([
      ...fullForm().filter(([k]) => k !== 'site'),
      ['site', 'https://a.example/'],
      ['site', 'https://b.example/'],
      ['site', 'https://c.example/'],
      ['site', 'https://d.example/'],
    ])
    expect(response.status).toBe(400)
    expect(await flat(response)).toContain('ほかのリンクは 3 つまでです。')
    expect((await orm.select().from(communities).get())?.name).toBe(
      'Kanagawa.pm',
    )
  })

  test('F30-AC37: Given a description over 160 characters, When saved, Then the reason shows and the text stays', async () => {
    const long = 'あ'.repeat(161)
    const response = await save(fullForm({ description: long }))
    expect(response.status).toBe(400)
    const body = await flat(response)
    expect(body).toContain('説明は 160 文字までです。')
    expect(body).toContain(long)
  })

  test('F30-AC13: Given a link another community holds, When saved, Then the field names it and nothing changes', async () => {
    await seedCommunity(db, {
      id: 9,
      handle: 'hono',
      links: ['https://hono.connpass.com/'],
    })
    const response = await save(
      fullForm({ link: 'https://hono.connpass.com/' }),
    )
    expect(response.status).toBe(409)
    expect(await flat(response)).toContain(
      'slide.community/@hono</a > がすでに使っています。',
    )
    expect(
      (await orm.select().from(communities).where(eq(communities.id, ID)).get())
        ?.name,
    ).toBe('Kanagawa.pm')
  })

  test('F30-AC26: Given an admin, a person who is not one and someone signed out, When each opens the editing page, Then only the admin can, and only the admin sees "edit"', async () => {
    expect((await request('/@kanagawapm/edit')).status).toBe(200)
    expect((await request('/@kanagawapm/edit', {}, bob)).status).toBe(404)
    expect((await request('/@kanagawapm/edit', {}, '')).status).toBe(404)
    expect(await flat(await request('/@kanagawapm', {}, bob))).not.toContain(
      'コミュニティを編集',
    )
    expect(await flat(await request('/@kanagawapm', {}, ''))).not.toContain(
      'コミュニティを編集',
    )
  })

  test.each([
    ['not an admin', () => bob],
    ['signed out', () => ''],
  ])(
    'F30-AC26: Given someone %s, When they send every editing form, Then each is refused and nothing changes',
    async (_who, cookieOf) => {
      const cookie = cookieOf()
      expect(
        (await save(fullForm({ name: 'Taken over' }), cookie)).status,
      ).toBe(404)
      expect((await upload('logo', png(256, 256), cookie)).status).toBe(404)
      expect(
        (await postForm(`/communities/${ID}/logo/remove`, [], cookie)).status,
      ).toBe(404)
      expect(
        (await postForm(`/communities/${ID}/cover/remove`, [], cookie)).status,
      ).toBe(404)
      const row = await orm.select().from(communities).get()
      expect(row).toMatchObject({ name: 'Kanagawa.pm', logo_at: null })
    },
  )
})

describe('the logo and the cover', () => {
  test('F30-AC30: Given a 256 by 256 PNG with text, When it is put up as the logo, Then the logo shows it, without the text, and is served as a PNG', async () => {
    const response = await upload('logo', withPngText(png(256, 256), 'secret'))
    expect(response.status).toBe(303)
    const row = await orm.select().from(communities).get()
    expect(row?.logo_at).toEqual(expect.any(Number))
    const page = await flat(await request('/@kanagawapm'))
    expect(page).toContain(`src="/communities/${ID}/logo?v=${row?.logo_at}"`)
    const served = await request(
      `/communities/${ID}/logo?v=${row?.logo_at}`,
      {},
      '',
    )
    expect(served.status).toBe(200)
    expect(served.headers.get('Content-Type')).toBe('image/png')
    expect(served.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(served.headers.get('Cache-Control')).toContain('immutable')
    expect(
      chunkTypes(new Uint8Array(await served.arrayBuffer())),
    ).not.toContain('tEXt')
  })

  test.each([
    [1600, 400],
    [800, 200],
    [1001, 250],
  ])(
    'F30-AC30: Given a %ix%i PNG, When it is put up as the cover, Then it is kept at 4:1 and shown',
    async (width, height) => {
      expect((await upload('cover', png(width, height))).status).toBe(303)
      const row = await orm.select().from(communities).get()
      expect(await flat(await request('/@kanagawapm'))).toContain(
        `src="/communities/${ID}/cover?v=${row?.cover_at}"`,
      )
    },
  )

  test.each([
    ['a cover wider than 1600', 'cover', () => png(2000, 500)],
    ['a cover that is not 4:1', 'cover', () => png(1600, 900)],
    ['a logo that is not square', 'logo', () => png(256, 200)],
    [
      'a JPEG named .png',
      'logo',
      () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
    ],
    [
      'HTML named .png',
      'logo',
      () => new TextEncoder().encode('<html><script>alert(1)</script>'),
    ],
    [
      'a logo PNG over its size',
      'logo',
      () => new Uint8Array(600 * 1024).fill(1),
    ],
    ['nothing at all', 'cover', () => new Uint8Array(0)],
  ] as const)(
    'F30-AC29: Given %s, When it is put up, Then it is refused with the reason and nothing is kept',
    async (_name, image, bytes) => {
      const response = await upload(image, bytes())
      expect(response.status).toBe(400)
      expect(await flat(response)).toContain('画像を受け取れませんでした。')
      const row = await orm.select().from(communities).get()
      expect(row).toMatchObject({ logo_at: null, cover_at: null })
      expect(await bucket.get(imageKey(ID, image))).toBeNull()
    },
  )

  test('F30-AC31: Given a logo and a cover, When "back to the initial" and "back to the default pattern" are pressed, Then the initial and the pattern show and the pictures are gone', async () => {
    expect((await upload('logo', png(256, 256))).status).toBe(303)
    expect((await upload('cover', png(1600, 400))).status).toBe(303)
    expect((await postForm(`/communities/${ID}/logo/remove`, [])).status).toBe(
      303,
    )
    expect((await postForm(`/communities/${ID}/cover/remove`, [])).status).toBe(
      303,
    )
    const page = await flat(await request('/@kanagawapm'))
    expect(page).toContain('class="cover-pattern"')
    expect(page).toMatch(
      /class="community-logo community-logo-96"[^>]*aria-hidden="true" >K</,
    )
    expect(await bucket.get(imageKey(ID, 'logo'))).toBeNull()
    expect((await request(`/communities/${ID}/cover`)).status).toBe(404)
  })

  test('F30-AC29: Given the editing page, When it is drawn, Then each file field checks the bytes and the size before shrinking', async () => {
    const body = await flat(await request('/@kanagawapm/edit'))
    expect(body).toMatch(
      /form="community-logo-form"[^>]*data-sniff[^>]*data-max-bytes="1048576"/,
    )
    expect(body).toMatch(
      /form="community-cover-form"[^>]*data-aspect="4" data-no-upscale[^>]*data-max-bytes="2097152"/,
    )
  })
})

describe('event names', () => {
  const eventId = async () =>
    (await orm
      .select()
      .from(events)
      .where(eq(events.key, 'https://connpass.com/event/410635'))
      .get())!.id
  beforeEach(async () => {
    await seedPublic(db, 'talk', 100, 'Talk')
    await seedTalkLink(db, {
      deckId: 'talk',
      url: 'https://kanagawapm.connpass.com/event/410635/',
      title: 'Old name',
    })
  })

  test('F29-AC22: F30-AC25: Given an admin of the event’s community, When they rename it, Then the event page shows the new name', async () => {
    const id = await eventId()
    expect(await flat(await request('/@kanagawapm/edit'))).toContain(
      'value="Old name"',
    )
    const response = await postForm(`/communities/${ID}/events/${id}/rename`, [
      ['name', 'Kanagawa.pm #3'],
    ])
    expect(response.status).toBe(303)
    expect(await flat(await request(`/events/${id}`, {}, ''))).toContain(
      '<h1>Kanagawa.pm #3</h1>',
    )
  })

  test('F29-AC22: Given someone not an admin, signed out, or an admin of another community, When they rename the event, Then it is refused and the name stays', async () => {
    const id = await eventId()
    await seedCommunity(db, {
      id: 50,
      handle: 'other',
      links: ['https://other.connpass.com/'],
      creator: '2',
    })
    for (const [path, cookie] of [
      [`/communities/${ID}/events/${id}/rename`, bob],
      [`/communities/${ID}/events/${id}/rename`, ''],
      [`/communities/50/events/${id}/rename`, bob],
    ] as const)
      expect(
        (await postForm(path, [['name', 'Hijacked']], cookie)).status,
      ).toBe(404)
    expect((await orm.select().from(events).get())?.name).toBe('Old name')
  })

  test('F29-AC22: Given an admin who left, When they rename the event, Then it is refused', async () => {
    await orm.delete(communityAdmins)
    expect(
      (
        await postForm(`/communities/${ID}/events/${await eventId()}/rename`, [
          ['name', 'x'],
        ])
      ).status,
    ).toBe(404)
  })
})
