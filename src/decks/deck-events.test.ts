import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { eventRefOf } from '../events/event-url'
import { listLinks, setLinkKind } from '../links/store'
import {
  resetCommunities,
  seedCommunity,
} from '../communities/test-communities'
import {
  OWNER_ID,
  seedDeck,
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

let owner = ''
let other = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetCommunities(db)
  owner = await signIn(env)
  other = await signIn(env, 'other', { id: '2' })
  await seedPublic(db, 'talk', 100, 'Talk')
})
afterAll(() => platform.dispose())

const post = (path: string, fields: Record<string, string>, cookie = owner) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )
const page = async (lang = 'ja', slug = 'talk') =>
  (
    await (
      await server.fetch(
        new Request(`${TEST_ORIGIN}/my/slides/${slug}?lang=${lang}`, {
          headers: { Cookie: owner },
        }),
        env,
      )
    ).text()
  ).replace(/\s+/g, ' ')
const frame = (body: string, name: string) =>
  new RegExp(`<section[^>]*data-deck-frame="${name}"[\\s\\S]*?</section>`).exec(
    body,
  )?.[0] ?? ''
const kinds = async () => (await listLinks(db, 'talk')).map((link) => link.kind)

test('F27-AC87: Given the add form, When the slide page opens, Then it has no choice of kind, in either language', async () => {
  for (const lang of ['ja', 'en'] as const) {
    const body = await page(lang)
    const form =
      /<form[^>]*class="link-form"[\s\S]*?<\/form>/.exec(body)?.[0] ?? ''
    expect(form).toContain('name="url"')
    expect(form).not.toMatch(/<select|name="kind"/)
    expect(frame(body, 'links')).not.toMatch(/<select/)
  }
})

test('F27-AC87: Given a link that is added without a kind, When its row is shown, Then the kind is the one its URL stands for', async () => {
  await post('/my/slides/talk/links', {
    url: 'https://luma.com/x1',
    title: 'Night',
  })
  expect(await kinds()).toEqual(['event'])
  expect(frame(await page(), 'links')).toMatch(
    /class="link-row-kind"[\s\S]*?イベント/,
  )
})

test('F27-AC88: F45-AC37: Given links of the slide, When kinds are saved to the route the page no longer links to, Then the new kinds are shown on the page, and an address shaped like an event stays an event', async () => {
  await post('/my/slides/talk/links', {
    url: 'https://example.com/a',
    title: 'A',
  })
  await post('/my/slides/talk/links', {
    url: 'https://example.com/b',
    title: 'B',
  })
  await post('/my/slides/talk/links', {
    url: 'https://luma.com/x1',
    title: 'Night',
  })
  const [a, b, night] = await listLinks(db, 'talk')
  const response = await post('/my/slides/talk/links/kinds', {
    [`kind-${a!.id}`]: 'event',
    [`kind-${b!.id}`]: 'video',
    [`kind-${night!.id}`]: 'video',
  })
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/my/slides/talk#links')
  expect(await kinds()).toEqual(['event', 'video', 'event'])
  const links = frame(await page(), 'links')
  expect(
    [...links.matchAll(/class="link-row-kind"[\s\S]*?<\/span/g)].map(
      ([row]) => /イベント|動画/.exec(row)?.[0],
    ),
  ).toEqual(['イベント', '動画', 'イベント'])
})

test('F27-AC88: Given a kind that is none of the four, When it is saved, Then nothing changes and the reason is shown', async () => {
  await post('/my/slides/talk/links', { url: 'https://example.com/a' })
  const [a] = await listLinks(db, 'talk')
  const response = await post('/my/slides/talk/links/kinds', {
    [`kind-${a!.id}`]: 'podcast',
  })
  expect(response.headers.get('Location')).toBe(
    '/my/slides/talk?links=kind#links',
  )
  expect(await kinds()).toEqual(['other'])
})

test("F27-AC88: Given another author's slide, When kinds are saved on it, Then it is not found and nothing changes", async () => {
  await post('/my/slides/talk/links', { url: 'https://luma.com/x1' })
  const [link] = await listLinks(db, 'talk')
  const response = await post(
    '/my/slides/talk/links/kinds',
    { [`kind-${link!.id}`]: 'other' },
    other,
  )
  expect(response.status).toBe(404)
  expect(await kinds()).toEqual(['event'])
})

test("F29-AC29: Given a link that goes into a community, a link whose page of links shows, a link to an event with no public slide and a link that is no event, When the slide page opens, Then the rows say the community's page, the page of links, and nothing", async () => {
  await seedCommunity(db, {
    id: 5,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
  })
  await seedDeck(db, 'draft')
  const urls = [
    'https://kanagawapm.connpass.com/event/1/',
    'https://luma.com/x1',
    'https://youtube.com/watch?v=1',
  ]
  for (const url of urls) await post('/my/slides/talk/links', { url })
  // An event on a draft only: its page of links does not show.
  await post('/my/slides/draft/links', { url: 'https://luma.com/x2' })
  const places = async (slug: string, lang = 'ja') =>
    frame(await page(lang, slug), 'links')
      .split('<li class="link-row">')
      .slice(1)
      .map(
        (row) =>
          /<span class="link-row-place"\s*>([^<]*)<\/span/.exec(row)?.[1] ??
          null,
      )
  expect(await places('talk')).toEqual([
    'Kanagawa.pm のページに並びます。',
    'リンクのページに並びます。',
    null,
  ])
  expect(await places('talk', 'en')).toEqual([
    'Listed on the page of Kanagawa.pm.',
    'Listed on the page of this link.',
    null,
  ])
  expect(await places('draft')).toEqual([null])
  expect(await page()).not.toContain('イベントとして並びます')
})

test('F29-AC30: Given links to two events with a page, one of them twice and one in a community, and a link to an event with no public slide, When the slide page opens, Then the frame lists each page once in the order added, with its community, and has no way to choose', async () => {
  await seedCommunity(db, {
    id: 5,
    handle: 'kanagawapm',
    name: 'Kanagawa.pm',
    links: ['https://kanagawapm.connpass.com/'],
  })
  await seedDeck(db, 'draft')
  await post('/my/slides/talk/links', {
    url: 'https://luma.com/x1',
    title: 'Hono Night #5',
  })
  await post('/my/slides/talk/links', {
    url: 'https://kanagawapm.connpass.com/event/410635/',
  })
  await post('/my/slides/talk/links', { url: 'https://lu.ma/x1/' })
  await post('/my/slides/draft/links', { url: 'https://luma.com/x1' })
  await post('/my/slides/draft/links', { url: 'https://luma.com/x2' })
  const rows = (pages: string) =>
    pages
      .split('<li class="link-row">')
      .slice(1)
      .map((row) => [
        /<a class="link-row-title" href="([^"]*)"/.exec(row)?.[1],
        /<a class="link-row-title"[^>]*>([^<]*)</.exec(row)?.[1],
        /<span class="link-row-site"\s*>([^<]*)</.exec(row)?.[1] ?? null,
      ])
  const pages = frame(await page(), 'placed-pages')
  expect(pages).toContain('<h2>このスライドが並ぶページ</h2>')
  expect(rows(pages)).toEqual([
    ['/link/luma.com/x1', 'Hono Night #5', null],
    [
      '/link/connpass.com/event/410635',
      'connpass https://connpass.com/event/410635/',
      'Kanagawa.pm',
    ],
  ])
  expect(pages).toContain('関連リンクから決まるので、ここでは選べません。')
  expect(pages).not.toMatch(/<form|<select|<input|<button/)
  expect(frame(await page('en'), 'placed-pages')).toContain(
    '<h2>Pages this slide appears on</h2>',
  )
  // The draft is on the page of an event another slide made public; the
  // event only it links to has no page.
  expect(rows(frame(await page('ja', 'draft'), 'placed-pages'))).toEqual([
    ['/link/luma.com/x1', 'Hono Night #5', null],
  ])
  expect(await page()).not.toContain('発表したイベント')
})

test('F29-AC30: Given no related link with a page, When the slide page opens, Then the frame says in one sentence that the related links decide the pages', async () => {
  await post('/my/slides/talk/links', { url: 'https://youtube.com/watch?v=1' })
  const pages = frame(await page(), 'placed-pages')
  expect(pages).toContain(
    '<p class="field-note">並ぶページは、関連リンクから決まります。いまは、並ぶページがありません。</p>',
  )
  expect(pages).not.toContain('<ul')
  expect(frame(await page('en'), 'placed-pages')).toContain(
    '<p class="field-note">The related links decide the pages. For now it appears on none.</p>',
  )
})

test('F29-AC16: Given fetch watched, When event links are added, their kinds saved and the slide page opened, Then nothing is fetched', async () => {
  const fetched = vi.spyOn(globalThis, 'fetch')
  try {
    await post('/my/slides/talk/links', {
      url: 'https://kanagawapm.connpass.com/event/1/',
    })
    const [link] = await listLinks(db, 'talk')
    await post('/my/slides/talk/links/kinds', { [`kind-${link!.id}`]: 'other' })
    await page()
    expect(fetched).not.toHaveBeenCalled()
  } finally {
    fetched.mockRestore()
  }
})

test.each([
  ['https://loom.com/embed/x', '/link/loom.com/embed/x'],
  ['https://vimeo.com/123/abc', '/link/vimeo.com/123/abc'],
  ['https://www.example.com/conf/', '/link/www.example.com/conf'],
])(
  'F29-AC18: Given %s made an event by the tool, When the slide page opens, Then the frame of pages leads to %s, and the slide is listed there',
  async (url, path) => {
    await post('/my/slides/talk/links', { url, title: 'Talk night' })
    const [link] = await listLinks(db, 'talk')
    await setLinkKind(db, {
      deckId: 'talk',
      ownerUserId: OWNER_ID,
      linkId: link!.id,
      kinding: { kind: 'event', event: eventRefOf(url)! },
      now: 1,
    })
    expect(frame(await page(), 'placed-pages')).toContain(
      `<a class="link-row-title" href="${path}"`,
    )
    const listed = await server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)
    expect(listed.status).toBe(200)
    expect(await listed.text()).toContain('<span class="deck-name">Talk</span>')
  },
)
