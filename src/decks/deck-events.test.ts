import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { listLinks } from '../links/store'
import { seedCommunity } from '../communities/test-communities'
import {
  resetTables,
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
  await resetTables(db)
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

test('F27-AC88: Given links of the slide, When kinds are saved to the route the page no longer links to, Then the new kinds are shown on the page', async () => {
  await post('/my/slides/talk/links', {
    url: 'https://example.com/a',
    title: 'A',
  })
  await post('/my/slides/talk/links', {
    url: 'https://luma.com/x1',
    title: 'Night',
  })
  const [a, night] = await listLinks(db, 'talk')
  const response = await post('/my/slides/talk/links/kinds', {
    [`kind-${a!.id}`]: 'event',
    [`kind-${night!.id}`]: 'video',
  })
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/my/slides/talk#links')
  expect(await kinds()).toEqual(['event', 'video'])
  const links = frame(await page(), 'links')
  expect(
    [...links.matchAll(/class="link-row-kind"[\s\S]*?<\/span/g)].map(
      ([row]) => /イベント|動画/.exec(row)?.[0],
    ),
  ).toEqual(['イベント', '動画'])
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

test('F29-AC18: Given links to two events, one of them twice, When the slide page opens, Then the events frame lists each event once in the order added, and has no way to choose', async () => {
  await post('/my/slides/talk/links', {
    url: 'https://luma.com/x1',
    title: 'Hono Night #5',
  })
  await post('/my/slides/talk/links', {
    url: 'https://kanagawapm.connpass.com/event/410635/',
  })
  await post('/my/slides/talk/links', { url: 'https://lu.ma/x1/' })
  const events = frame(await page(), 'events')
  expect(events).toContain('<h2>発表したイベント</h2>')
  expect(
    [
      ...events.matchAll(/<a class="link-row-title" href="([^"]*)" >([^<]*)</g),
    ].map(([, href, name]) => [href, name]),
  ).toEqual([
    ['/link/luma.com/x1', 'Hono Night #5'],
    [
      '/link/connpass.com/event/410635',
      'connpass https://connpass.com/event/410635/',
    ],
  ])
  expect(events).toContain('関連リンクから決まるので、ここでは選べません。')
  expect(events).not.toMatch(/<form|<select|<input|<button/)
})

test('F29-AC18: Given no link of the kind event, When the slide page opens, Then the events frame says in one sentence that events come from the related links', async () => {
  await post('/my/slides/talk/links', { url: 'https://youtube.com/watch?v=1' })
  const events = frame(await page(), 'events')
  expect(events).toContain(
    '<p class="field-note">関連リンクに、種類が「イベント」のリンクを足すと、そのイベントがここに並びます。</p>',
  )
  expect(events).not.toContain('<ul')
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
