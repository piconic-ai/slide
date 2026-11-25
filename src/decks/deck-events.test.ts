import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { listLinks } from '../links/store'
import {
  resetTables,
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
const page = async (lang = 'ja') =>
  (
    await (
      await server.fetch(
        new Request(`${TEST_ORIGIN}/slides/talk?lang=${lang}`, {
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

test('F27-AC83: Given the add form, When the slide page opens, Then the kind is chosen from the four kinds, from the URL unless chosen, in either language', async () => {
  for (const [lang, names] of [
    ['ja', ['URL から決める', '動画', '記事', 'イベント', 'その他']],
    ['en', ['From the URL', 'Video', 'Article', 'Event', 'Other']],
  ] as const) {
    const form =
      /<form[^>]*class="link-form"[\s\S]*?<\/form>/.exec(
        await page(lang),
      )?.[0] ?? ''
    const select = /<select id="link-kind" name="kind">[\s\S]*?<\/select>/.exec(
      form,
    )?.[0]
    expect(select).toBeDefined()
    expect(
      [
        ...(select ?? '').matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g),
      ].map(([, value, name]) => [value, name?.trim()]),
    ).toEqual([
      ['', names[0]],
      ['video', names[1]],
      ['article', names[2]],
      ['event', names[3]],
      ['other', names[4]],
    ])
    expect(select).toMatch(/<option value="" selected>/)
  }
})

test('F27-AC84: Given links of the slide, When the author chooses kinds again and saves, Then the new kinds are shown on the page', async () => {
  await post('/slides/talk/links', { url: 'https://example.com/a', title: 'A' })
  await post('/slides/talk/links', {
    url: 'https://luma.com/x1',
    title: 'Night',
  })
  const [a, night] = await listLinks(db, 'talk')
  const response = await post('/slides/talk/links/kinds', {
    [`kind-${a!.id}`]: 'event',
    [`kind-${night!.id}`]: 'video',
  })
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/slides/talk#links')
  expect(await kinds()).toEqual(['event', 'video'])
  const links = frame(await page(), 'links')
  expect(links).toMatch(
    new RegExp(
      `name="kind-${a!.id}"[^>]*>[\\s\\S]*?<option value="event" selected>`,
    ),
  )
  expect(links).toMatch(
    new RegExp(
      `name="kind-${night!.id}"[^>]*>[\\s\\S]*?<option value="video" selected>`,
    ),
  )
})

test('F27-AC84: Given a kind that is none of the four, When it is saved, Then nothing changes and the reason is shown', async () => {
  await post('/slides/talk/links', { url: 'https://example.com/a' })
  const [a] = await listLinks(db, 'talk')
  const response = await post('/slides/talk/links/kinds', {
    [`kind-${a!.id}`]: 'podcast',
  })
  expect(response.headers.get('Location')).toBe('/slides/talk?links=kind#links')
  expect(await kinds()).toEqual(['other'])
})

test("F27-AC84: Given another author's slide, When kinds are saved on it, Then it is not found and nothing changes", async () => {
  await post('/slides/talk/links', { url: 'https://luma.com/x1' })
  const [link] = await listLinks(db, 'talk')
  const response = await post(
    '/slides/talk/links/kinds',
    { [`kind-${link!.id}`]: 'other' },
    other,
  )
  expect(response.status).toBe(404)
  expect(await kinds()).toEqual(['event'])
})

test('F29-AC17: Given links of the kind event and of another kind, When the slide page opens, Then only under the event rows one sentence says it is listed as a talk of the event', async () => {
  await post('/slides/talk/links', {
    url: 'https://kanagawapm.connpass.com/event/1/',
    title: 'Kanagawa.pm #3',
  })
  await post('/slides/talk/links', {
    url: 'https://youtube.com/watch?v=1',
    title: 'Video',
  })
  const rows = frame(await page(), 'links')
    .split('<li class="link-row">')
    .slice(1)
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatch(
    /<span class="link-row-place"\s*>イベントとして並びます。<\/span/,
  )
  expect(rows[1]).not.toContain('link-row-place')
  expect(frame(await page('en'), 'links')).toContain(
    'Listed as a talk of the event.',
  )
})

test('F29-AC18: Given links to two events, one of them twice, When the slide page opens, Then the events frame lists each event once in the order added, and has no way to choose', async () => {
  await post('/slides/talk/links', {
    url: 'https://luma.com/x1',
    title: 'Hono Night #5',
  })
  await post('/slides/talk/links', {
    url: 'https://kanagawapm.connpass.com/event/410635/',
  })
  await post('/slides/talk/links', { url: 'https://lu.ma/x1/' })
  const events = frame(await page(), 'events')
  expect(events).toContain('<h2>発表したイベント</h2>')
  expect(
    [
      ...events.matchAll(
        /<a class="link-row-title" href="(\/events\/\d+)" >([^<]*)</g,
      ),
    ].map(([, , name]) => name),
  ).toEqual(['Hono Night #5', 'connpass のイベント 410635'])
  expect(events).toContain('関連リンクから決まるので、ここでは選べません。')
  expect(events).not.toMatch(/<form|<select|<input|<button/)
})

test('F29-AC18: Given no link of the kind event, When the slide page opens, Then the events frame says in one sentence that events come from the related links', async () => {
  await post('/slides/talk/links', { url: 'https://youtube.com/watch?v=1' })
  const events = frame(await page(), 'events')
  expect(events).toContain(
    '<p class="field-note">関連リンクに、種類が「イベント」のリンクを足すと、そのイベントがここに並びます。</p>',
  )
  expect(events).not.toContain('<ul')
})

test('F29-AC16: Given fetch watched, When event links are added, their kinds saved and the slide page opened, Then nothing is fetched', async () => {
  const fetched = vi.spyOn(globalThis, 'fetch')
  try {
    await post('/slides/talk/links', {
      url: 'https://kanagawapm.connpass.com/event/1/',
    })
    const [link] = await listLinks(db, 'talk')
    await post('/slides/talk/links/kinds', { [`kind-${link!.id}`]: 'other' })
    await page()
    expect(fetched).not.toHaveBeenCalled()
  } finally {
    fetched.mockRestore()
  }
})
