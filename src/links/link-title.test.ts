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
// The author's budget of lookups is its own tests' business (see below); the
// others run with an open one, so they do not use each other's minute.
const open_ = { limit: async () => ({ success: true }) }
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  PAGE_SHOT_RATE_LIMITER: open_,
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

const realFetch = globalThis.fetch
type Answer = () => Response | Promise<Response>
/**
 * Answers the pages links lead to from a table and records every address
 * asked; nothing leaves the machine. Other requests pass through unchanged.
 */
function pages(table: Record<string, Answer>) {
  const asked: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    const answer = table[url]
    if (!answer) return realFetch(input, init)
    asked.push(url)
    return answer()
  })
  return asked
}
const page = (body: string) => () =>
  new Response(body, { headers: { 'content-type': 'text/html' } })

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

test('F27-AC21: Given an empty title, When a link is added, Then it is added and the page goes back to the slide', async () => {
  pages({ [URL1]: page('<title>Post</title>') })
  const response = await add({ url: URL1, title: '' })
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/slides/talk#links')
  expect(await listLinks(db, 'talk')).toHaveLength(1)
})

test('F27-AC23: Given an empty title and a page with og:title and <title>, When the link is added, Then og:title is stored, once', async () => {
  const asked = pages({
    [URL1]: page(
      '<title>Plain</title><meta property="og:title" content="Tom &amp; Jerry — 発表">',
    ),
  })
  await add({ url: URL1, title: '  ' })
  expect(await titles()).toEqual(['Tom & Jerry — 発表'])
  expect(asked).toEqual([URL1])
})

test('F27-AC23: Given a page with only a <title> over 100 characters, When the link is added, Then the title is cut to 100 characters', async () => {
  pages({ [URL1]: page(`<title>${'あ'.repeat(130)}</title>`) })
  await add({ url: URL1, title: '' })
  expect(await titles()).toEqual(['あ'.repeat(100)])
})

test('F27-AC22: Given a title that is typed, When the link is added, Then it is used and the page is not asked', async () => {
  const asked = pages({ [URL1]: page('<title>Not this</title>') })
  await add({ url: URL1, title: 'Mine' })
  expect(await titles()).toEqual(['Mine'])
  expect(asked).toEqual([])
})

test.each([
  ['a title of invisible characters', 'ㅤ'],
  ['a title with a direction override', 'a‮b'],
  ['a title of 101 characters', 'あ'.repeat(101)],
])(
  'F27-AC22: Given %s, When the link is added, Then it is refused and nothing is asked or saved',
  async (_, title) => {
    const asked = pages({ [URL1]: page('<title>x</title>') })
    const response = await add({ url: URL1, title })
    expect(response.headers.get('Location')).toMatch(
      /^\/slides\/talk\?links=title_/,
    )
    expect(asked).toEqual([])
    expect(await orm.select().from(relatedLinks).all()).toEqual([])
  },
)

test.each([
  ['the page does not answer', () => Promise.reject(new TypeError('down'))],
  [
    'the page is not found',
    () =>
      new Response('x', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
  ],
  [
    'the page is not HTML',
    () =>
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
  ],
  ['the page has no title', page('<p>no title</p>')],
  ['the title may not be kept', page('<title>a&#7;b</title>')],
])(
  'F27-AC24: Given that %s, When a link with an empty title is added, Then it is added with no title',
  async (_, answer) => {
    pages({ [URL1]: answer })
    const response = await add({ url: URL1, title: '' })
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/slides/talk#links')
    expect(await titles()).toEqual([null])
  },
)

test.each([
  ['an IP address', 'https://93.184.216.34/x'],
  ['localhost', 'https://localhost/x'],
  ['an .internal name', 'https://db.internal/x'],
  ['another port', 'https://blog.example:8443/x'],
  ['the service itself', `${TEST_ORIGIN}/@owner/talk`],
  ['its content domain', 'https://d-1.content.example/'],
])(
  'F27-AC25: Given a link to %s with an empty title, When it is added, Then it is kept with no title and nothing is asked',
  async (_, url) => {
    const asked = pages({})
    const spy = vi.mocked(globalThis.fetch)
    const response = await add({ url, title: '' })
    expect(response.headers.get('Location')).toBe('/slides/talk#links')
    expect(await titles()).toEqual([null])
    expect(asked).toEqual([])
    expect(
      spy.mock.calls.filter(
        ([input]) => String(input).startsWith('http') && String(input) === url,
      ),
    ).toEqual([])
  },
)

test('F27-AC26: Given a page that redirects to an internal address, When a link is added, Then only the first page is asked and the link has no title', async () => {
  const asked = pages({
    [URL1]: () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://10.0.0.5/secret' },
      }),
    'https://10.0.0.5/secret': page('<title>Secret</title>'),
  })
  await add({ url: URL1, title: '' })
  expect(asked).toEqual([URL1])
  expect(await titles()).toEqual([null])
})

test('F27-AC28: Given a page whose title is markup, When the link is added, Then it is stored as text and every screen escapes it', async () => {
  pages({
    [URL1]: page(
      '<title>&lt;img src=x onerror=alert(1)&gt; &lt;script&gt;x&lt;/script&gt;</title>',
    ),
  })
  await add({ url: URL1, title: '' })
  expect(await titles()).toEqual([
    '<img src=x onerror=alert(1)> <script>x</script>',
  ])
  for (const body of [
    await (await get('/slides/talk', owner)).text(),
    await (await get('/@owner/talk')).text(),
  ]) {
    expect(body).not.toContain('<img src=x')
    expect(body).not.toContain('<script>x</script>')
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;')
  }
})

test('F27-AC24: Given a link with no title, When the viewer and the slide page open, Then only the host name is shown, in both languages', async () => {
  pages({ [URL1]: () => Promise.reject(new TypeError('down')) })
  await add({ url: URL1, title: '' })
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
  expect(await (await get('/@owner/talk')).text()).toContain(
    'title="blog.example"',
  )
})

test('F27-AC29: Given a stored link with no title, When the viewer and the slide page open, Then nothing is asked and the title is not fetched again', async () => {
  pages({ [URL1]: () => Promise.reject(new TypeError('down')) })
  await add({ url: URL1, title: '' })
  const asked = pages({ [URL1]: page('<title>Now it works</title>') })
  await get('/@owner/talk')
  await get('/slides/talk', owner)
  await get('/@owner/talk?lang=en')
  expect(asked).toEqual([])
  expect(await titles()).toEqual([null])
})

test('F27-AC30: Given the add form, When the slide page opens, Then the title field says it is fetched when left empty, in both languages', async () => {
  const ja = flat(await (await get('/slides/talk', owner)).text())
  expect(ja).toContain('空のままだと、リンク先の題名を自動で取ります。')
  const en = flat(await (await get('/slides/talk?lang=en', owner)).text())
  expect(en).toContain(
    'If left empty, the title of the page the link leads to is fetched.',
  )
  expect(ja).not.toMatch(/id="link-title"[^>]*required/)
})

test('F27-AC21: Given the slide of another author, When they add a link with an empty title, Then the answer is the not-found page and nothing is asked', async () => {
  const asked = pages({ [URL1]: page('<title>T</title>') })
  const response = await add({ url: URL1, title: '' }, other)
  expect(response.status).toBe(404)
  expect(asked).toEqual([])
  expect(await orm.select().from(relatedLinks).all()).toEqual([])
})

test('F27-AC21: Given nine links, When four with empty titles are added at once, Then the limit of ten holds and the rest are refused', async () => {
  for (let n = 1; n < MAX_LINKS; n++)
    await add({ url: `https://own.example/${n}`, title: `Link ${n}` })
  pages(
    Object.fromEntries(
      [1, 2, 3, 4].map((n) => [
        `https://slow.example/${n}`,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          return page(`<title>Slow ${n}</title>`)()
        },
      ]),
    ),
  )
  const responses = await Promise.all(
    [1, 2, 3, 4].map((n) =>
      add({ url: `https://slow.example/${n}`, title: '' }),
    ),
  )
  const refused = responses.filter((r) =>
    r.headers.get('Location')?.includes('links=full'),
  )
  expect(refused).toHaveLength(3)
  expect(await orm.select().from(relatedLinks).all()).toHaveLength(MAX_LINKS)
})

test('F27-AC21: Given a new version, When it is published, Then a link whose title was fetched keeps it', async () => {
  pages({ [URL1]: page('<title>Kept</title>') })
  await add({ url: URL1, title: '' })
  const next = await seedDeployment(db, 'talk')
  await orm
    .update(decks)
    .set({ public_deployment_id: next })
    .where(eq(decks.id, 'talk'))
  expect(await titles()).toEqual(['Kept'])
})

test('F27-AC32: Given a deck that already has ten links, When a link with an empty title is added, Then nothing is asked and the answer is the refusal for a full deck', async () => {
  for (let n = 1; n <= MAX_LINKS; n++)
    await add({ url: `https://own.example/${n}`, title: `Link ${n}` })
  const asked = pages({ [URL1]: page('<title>T</title>') })
  const response = await add({ url: URL1, title: '' })
  expect(response.headers.get('Location')).toBe('/slides/talk?links=full#links')
  expect(asked).toEqual([])
  expect(await orm.select().from(relatedLinks).all()).toHaveLength(MAX_LINKS)
})

test('F27-AC32: Given the slide of another author or one that is gone, When a link with an empty title is added through the service, Then nothing is asked', async () => {
  const asked = pages({ [URL1]: page('<title>T</title>') })
  const { addLinkWithTitle } = await import('./api')
  const link = { kind: 'article', url: URL1, title: null } as const
  expect(
    await addLinkWithTitle(env, {
      deckId: 'talk',
      ownerUserId: '2',
      link,
      now: 1,
    }),
  ).toEqual({ result: 'missing' })
  expect(
    await addLinkWithTitle(env, {
      deckId: 'nothing',
      ownerUserId: '722500',
      link,
      now: 1,
    }),
  ).toEqual({ result: 'missing' })
  expect(asked).toEqual([])
})

test('F27-AC32: Given an author past their budget of lookups, When they add links with empty titles, Then the links are added with no title and nothing is asked', async () => {
  const asked = pages({ [URL1]: page('<title>T</title>') })
  const used: string[] = []
  let left = 2
  const counting = {
    limit: async ({ key }: { key: string }) => {
      used.push(key)
      return { success: left-- > 0 }
    },
  }
  const budgeted = {
    ...env,
    PAGE_SHOT_RATE_LIMITER: counting,
  } as unknown as Env
  const { addLinkWithTitle } = await import('./api')
  const results = []
  for (const n of [1, 2, 3]) {
    results.push(
      await addLinkWithTitle(budgeted, {
        deckId: 'talk',
        ownerUserId: '722500',
        link: { kind: 'article', url: `${URL1}/${n}`, title: null },
        now: n,
      }),
    )
  }
  expect(results.map((r) => r.result)).toEqual(['added', 'added', 'added'])
  expect(used).toEqual([
    'link-title:722500',
    'link-title:722500',
    'link-title:722500',
  ])
  // Two lookups were allowed (the pages are not in the table, so they failed); the third was not made.
  expect(await titles()).toEqual([null, null, null])
  expect(asked).toEqual([])
})

test('F27-AC32: Given the budget is used up, When a link has a typed title, Then it is added as typed and the budget is not touched', async () => {
  const used: string[] = []
  const budgeted = {
    ...env,
    PAGE_SHOT_RATE_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        used.push(key)
        return { success: false }
      },
    },
  } as unknown as Env
  const { addLinkWithTitle } = await import('./api')
  const added = await addLinkWithTitle(budgeted, {
    deckId: 'talk',
    ownerUserId: '722500',
    link: { kind: 'other', url: URL1, title: 'Typed' },
    now: 1,
  })
  expect(added).toEqual({ result: 'added', titleSource: 'given' })
  expect(used).toEqual([])
})

test('F27-AC32: Given the budget is over, When a lookup is refused, Then one author’s budget does not use another’s', async () => {
  const keys = new Set<string>()
  const budgeted = {
    ...env,
    PAGE_SHOT_RATE_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        keys.add(key)
        return { success: true }
      },
    },
  } as unknown as Env
  const { addLinkWithTitle } = await import('./api')
  await addLinkWithTitle(budgeted, {
    deckId: 'talk',
    ownerUserId: '722500',
    link: { kind: 'other', url: URL1, title: null },
    now: 1,
  })
  expect([...keys]).toEqual(['link-title:722500'])
})
