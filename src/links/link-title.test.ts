import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { decks, relatedLinks } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { MAX_LINKS } from './link'
import { listLinks } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
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
afterEach(() => vi.restoreAllMocks())
afterAll(() => platform.dispose())

/** Every request that leaves the service for somewhere else, while `use` runs. */
async function outside(use: () => Promise<void>) {
  const spy = vi.spyOn(globalThis, 'fetch')
  await use()
  const asked = spy.mock.calls
    .map(([input]) => String(input instanceof Request ? input.url : input))
    .filter((url) => !url.startsWith(TEST_ORIGIN))
  spy.mockRestore()
  return asked
}

const form = (path: string, cookie: string, fields: Record<string, string>) =>
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
const get = (path: string, cookie = '') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: cookie } }),
    env,
  )
const add = (fields: Record<string, string>, cookie = owner, deck = 'talk') =>
  form(`/slides/${deck}/links`, cookie, { kind: 'article', ...fields })
const titles = async () => (await listLinks(db, 'talk')).map((l) => l.title)
const flat = (body: string) => body.replace(/\s+/g, ' ')
const URL1 = 'https://blog.example/post'

test('F27-AC21: Given an empty title, When a link is added, Then it is added with no title, the page goes back to the slide, and no request leaves the service', async () => {
  let response: Response | undefined
  const asked = await outside(async () => {
    response = await add({ url: URL1, title: '' })
  })
  expect(response?.status).toBe(303)
  expect(response?.headers.get('Location')).toBe('/slides/talk#links')
  expect(await titles()).toEqual([null])
  expect(asked).toEqual([])
})

test.each(['', '   ', '　'])(
  'F27-AC21: Given the title %j, When a link is added, Then it is the same as no title',
  async (title) => {
    await add({ url: URL1, title })
    expect(await titles()).toEqual([null])
  },
)

test('F27-AC22: Given a title that is typed, When the link is added, Then it is used as typed and no request leaves the service', async () => {
  const asked = await outside(async () => {
    await add({ url: URL1, title: 'Mine' })
  })
  expect(await titles()).toEqual(['Mine'])
  expect(asked).toEqual([])
})

test.each([
  ['a title of invisible characters', 'ㅤ'],
  ['a title with a direction override', 'a‮b'],
  ['a title of 101 characters', 'あ'.repeat(101)],
])(
  'F27-AC22: Given %s, When the link is added, Then it is refused and nothing is saved',
  async (_, title) => {
    const response = await add({ url: URL1, title })
    expect(response.headers.get('Location')).toMatch(
      /^\/slides\/talk\?links=title_/,
    )
    expect(await orm.select().from(relatedLinks).all()).toEqual([])
  },
)

test('F27-AC39: Given links with no title, When the viewer and the slide page open, Then only the host name is shown, in both languages, and no request leaves the service', async () => {
  await add({ url: URL1, title: '' })
  const asked = await outside(async () => {
    for (const lang of ['ja', 'en']) {
      const viewer = flat(await (await get(`/@owner/talk?lang=${lang}`)).text())
      expect(viewer).toMatch(/related-link-title">\s*blog\.example\s*</)
      expect(viewer).not.toContain('class="related-link-site"')
      const manage = flat(
        await (await get(`/slides/talk?lang=${lang}`, owner)).text(),
      )
      expect(manage).toMatch(/link-row-title">\s*blog\.example\s*</)
      expect(manage).not.toContain('class="link-row-site"')
    }
  })
  expect(asked).toEqual([])
  expect(await (await get('/@owner/talk')).text()).toContain(
    'title="blog.example"',
  )
})

test('F27-AC39: Given a link with a title, When the viewer opens, Then the title and the site name are both shown', async () => {
  await add({ url: URL1, title: 'The post' })
  const viewer = flat(await (await get('/@owner/talk')).text())
  expect(viewer).toMatch(/related-link-title">\s*The post\s*</)
  expect(viewer).toMatch(/related-link-site"\s*>\s*blog\.example\s*</)
})

test('F27-AC43: Given a typed title that is markup, When the screens open, Then it is escaped everywhere', async () => {
  await add({
    url: URL1,
    title: '<img src=x onerror=alert(1)> <script>x</script>',
  })
  for (const body of [
    await (await get('/slides/talk', owner)).text(),
    await (await get('/@owner/talk')).text(),
  ]) {
    expect(body).not.toContain('<img src=x')
    expect(body).not.toContain('<script>x</script>')
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;')
  }
})

test('F27-AC40: Given the add form, When the slide page opens, Then the title field says the site name is shown when it is left empty, in both languages', async () => {
  const ja = flat(await (await get('/slides/talk', owner)).text())
  expect(ja).toContain('未入力の場合は、サイト名(例: zenn.dev)を出します。')
  const en = flat(await (await get('/slides/talk?lang=en', owner)).text())
  expect(en).toContain('If left blank, the site name (e.g. zenn.dev) is shown.')
  expect(ja).not.toMatch(/id="link-title"[^>]*required/)
  expect(ja + en).not.toContain('リンク先の題名')
})

test('F27-AC21: Given the slide of another author, When they add a link with an empty title, Then the answer is the not-found page and nothing is saved', async () => {
  const response = await add({ url: URL1, title: '' }, other)
  expect(response.status).toBe(404)
  expect(await orm.select().from(relatedLinks).all()).toEqual([])
})

test('F27-AC21: Given nine links, When four with empty titles are added at once, Then the limit of ten holds and the rest are refused', async () => {
  for (let n = 1; n < MAX_LINKS; n++)
    await add({ url: `https://own.example/${n}`, title: `Link ${n}` })
  const responses = await Promise.all(
    [1, 2, 3, 4].map((n) =>
      add({ url: `https://blog.example/${n}`, title: '' }),
    ),
  )
  const refused = responses.filter((r) =>
    r.headers.get('Location')?.includes('links=full'),
  )
  expect(refused).toHaveLength(3)
  expect(await orm.select().from(relatedLinks).all()).toHaveLength(MAX_LINKS)
})

test('F27-AC14: Given a link with no title, When a new version is published, Then the link stays', async () => {
  await add({ url: URL1, title: '' })
  const next = await seedDeployment(db, 'talk')
  await orm
    .update(decks)
    .set({ public_deployment_id: next })
    .where(eq(decks.id, 'talk'))
  expect(await titles()).toEqual([null])
})

test('F27-AC86: Given the form without a kind, When links to a video site, an article site and another are added, Then each has the kind its address says', async () => {
  for (const url of [
    'https://www.youtube.com/watch?v=1',
    'https://zenn.dev/a/articles/b',
    'https://example.com/c',
  ])
    await form('/slides/talk/links', owner, { url, title: 'T' })
  expect((await listLinks(db, 'talk')).map((link) => link.kind)).toEqual([
    'video',
    'article',
    'other',
  ])
})

test('F27-AC37: Given the add form, When the slide page opens, Then it does not say that only https addresses work; Given an address that is not https is sent, Then the refusal says so', async () => {
  const opened = flat(await (await get('/slides/talk', owner)).text())
  const formHtml =
    /<form[^>]*class="link-form"[\s\S]*?<\/form>/.exec(opened)?.[0] ?? ''
  expect(formHtml).toContain('id="link-url"')
  expect(formHtml).not.toContain('https:// で始まる')
  expect(formHtml).not.toContain('link-url-note')
  const response = await add({ url: 'http://blog.example/post', title: 'T' })
  expect(response.headers.get('Location')).toBe(
    '/slides/talk?links=url_scheme#links',
  )
  const refused = flat(
    await (await get('/slides/talk?links=url_scheme', owner)).text(),
  )
  expect(refused).toContain('https:// で始まる URL だけ使えます。')
  expect(await titles()).toEqual([])
})

test('F27-AC42: Given a link with a title, one without, and the screens that show them, When all of it is done, Then no request leaves the service', async () => {
  const asked = await outside(async () => {
    await add({ url: 'https://blog.example/a', title: 'Typed' })
    await add({ url: 'https://blog.example/b', title: '' })
    await get('/slides/talk', owner)
    await get('/@owner/talk')
    await get('/@owner/talk?lang=en')
  })
  expect(asked).toEqual([])
  expect(await titles()).toEqual(['Typed', null])
})
