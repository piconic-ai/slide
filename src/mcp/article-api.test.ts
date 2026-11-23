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
import type { Client } from '@modelcontextprotocol/client'
import server from '../app/routes'
import { autosaveArticle, keepArticle, readArticle } from '../articles/store'
import { MAX_ARTICLE_CHARS } from '../articles/markdown'
import { articleCitations, decks, relatedLinks } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { MAX_LINKS } from '../links/link'
import {
  INVITED_ID,
  OWNER_ID,
  seedDeck,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { callTool, connectAgent, mcpClient } from './test-connect'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
let alice = ''
let client: Client

beforeAll(async () => {
  await applyMigrations(database)
  alice = await signIn(env, 'alice')
  client = await mcpClient(
    env,
    (await connectAgent(env, alice)).tokens.access_token,
  )
  await seedPublic(database, 'talk', 100, 'Talk', OWNER_ID)
  await seedDeck(database, 'live', OWNER_ID)
  await seedDeck(database, 'bobs', INVITED_ID, 'secret')
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  await client.close()
  await platform.dispose()
})

const deckId = async (slug: string) =>
  (await db.select().from(decks).where(eq(decks.slug, slug)))[0]!.id
const linksOf = async (slug: string) =>
  db
    .select()
    .from(relatedLinks)
    .where(eq(relatedLinks.deck_id, await deckId(slug)))
const page = (path: string) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: { Cookie: alice },
    }),
    env,
  )
const link = (slide: string, extra: Record<string, unknown> = {}) =>
  callTool(client, 'add_related_link', {
    slide,
    kind: 'video',
    url: 'https://video.example/talk',
    title: 'Recording',
    ...extra,
  })

test('F23-AC13, F23-AC22: Given an own slide, When put_article_draft gets a body, Then it is saved as a draft and the article page URL and the next step come back', async () => {
  const { isError, data } = await callTool(client, 'put_article_draft', {
    slide: 'talk',
    body: '# Notes\n\nhttps://slide.example/@alice/talk/3\n',
  })
  expect(isError).toBe(false)
  expect(data).toEqual({
    slide: 'talk',
    status: 'draft',
    editUrl: `${TEST_ORIGIN}/slides/talk/article`,
    nextStep: expect.stringContaining('press Publish'),
  })
  expect(await readArticle(database, await deckId('talk'))).toMatchObject({
    status: 'draft',
    body: '# Notes\n\nhttps://slide.example/@alice/talk/3\n',
  })
  // A draft holds no citations.
  expect(await db.select().from(articleCitations)).toEqual([])
  // Saving again replaces the draft.
  await callTool(client, 'put_article_draft', { slide: 'talk', body: 'Two' })
  expect(await readArticle(database, await deckId('talk'))).toMatchObject({
    body: 'Two',
  })
})

test('F23-AC14: Given a slide with a published article, When put_article_draft is called, Then it is refused, pointing to the article page, and the article is unchanged', async () => {
  const id = await deckId('live')
  await keepArticle(database, {
    deckId: id,
    body: 'Public text',
    status: 'published',
    citations: [],
    now: 1,
  })
  const { isError, data } = await callTool(client, 'put_article_draft', {
    slide: 'live',
    body: 'Overwrite',
  })
  expect(isError).toBe(true)
  expect(data.error).toBe('article_published')
  expect(data.message).toContain(`${TEST_ORIGIN}/slides/live/article`)
  expect(await readArticle(database, id)).toMatchObject({
    status: 'published',
    body: 'Public text',
  })
})

test('F23-AC14, F26-AC48: Given a published article with an edit of the author’s, When put_article_draft is called, Then it is refused, and neither the published text nor the edit is touched', async () => {
  const id = await deckId('live')
  await keepArticle(database, {
    deckId: id,
    body: 'Public text',
    status: 'published',
    citations: [],
    now: 1,
  })
  await autosaveArticle(database, {
    deckId: id,
    body: 'The author edit',
    known: (await readArticle(database, id))!.revision,
    now: 2,
  })
  const { isError, data } = await callTool(client, 'put_article_draft', {
    slide: 'live',
    body: 'Overwrite',
  })
  expect(isError).toBe(true)
  expect(data.error).toBe('article_published')
  expect(await readArticle(database, id)).toMatchObject({
    body: 'Public text',
    draftBody: 'The author edit',
  })
  // The edit is the author's, kept apart from readers; the tools never show it.
  expect(JSON.stringify(data)).not.toContain('The author edit')
})

test('F23-AC17: Given a body of 50,000 characters and one of 50,001, When put_article_draft is called, Then the first is kept and the second is refused with the reason', async () => {
  const ok = await callTool(client, 'put_article_draft', {
    slide: 'talk',
    body: '🙂'.repeat(MAX_ARTICLE_CHARS),
  })
  expect(ok.isError).toBe(false)
  const { isError, data } = await callTool(client, 'put_article_draft', {
    slide: 'talk',
    body: 'a'.repeat(MAX_ARTICLE_CHARS + 1),
  })
  expect(isError).toBe(true)
  expect(data).toMatchObject({
    error: 'body_too_long',
    message: expect.stringContaining('50000'),
  })
  expect((await readArticle(database, await deckId('talk')))?.body.length).toBe(
    MAX_ARTICLE_CHARS * 2,
  )
})

test('F23-AC15, F23-AC16, F23-AC22: Given an own slide, When a link is added and then removed, Then the manage page shows it and then does not, and the manage URL comes back', async () => {
  const added = await link('talk')
  expect(added.isError).toBe(false)
  expect(added.data).toMatchObject({
    slide: 'talk',
    editUrl: `${TEST_ORIGIN}/slides/talk#links`,
    nextStep: expect.stringContaining('manage page'),
    links: [{ kind: 'video', url: 'https://video.example/talk' }],
  })
  for (const path of ['/slides/talk', '/@alice/talk'])
    expect(await (await page(path)).text()).toContain('Recording')
  const [{ id }] = (added.data.links as { id: string }[]).slice(-1)
  const removed = await callTool(client, 'remove_related_link', {
    slide: 'talk',
    linkId: id,
  })
  expect(removed.isError).toBe(false)
  expect(removed.data.links).toEqual([])
  expect(await linksOf('talk')).toEqual([])
  for (const path of ['/slides/talk', '/@alice/talk'])
    expect(await (await page(path)).text()).not.toContain('Recording')
  // A link that is not there is refused.
  const again = await callTool(client, 'remove_related_link', {
    slide: 'talk',
    linkId: id,
  })
  expect(again.data.error).toBe('unknown_link')
})

test.each([
  ['http:', { url: 'http://video.example/x' }, 'link_url_scheme'],
  ['javascript:', { url: 'javascript:alert(1)' }, 'link_url_scheme'],
  ['credentials', { url: 'https://u:p@x.example/' }, 'link_url_credentials'],
  ['an invisible title', { title: '\u3164' }, 'link_title_missing'],
])(
  'F23-AC18: Given %s, When add_related_link is called, Then it is refused with the reason and nothing is added',
  async (_, extra, code) => {
    const { isError, data } = await link('talk', extra)
    expect(isError).toBe(true)
    expect(data.error).toBe(code)
    expect(data.message).toEqual(expect.any(String))
    expect(await linksOf('talk')).toEqual([])
  },
)

test('F23-AC19: Given a slide with 10 links, When an 11th is added, Then it is refused with the reason', async () => {
  for (let i = 0; i < MAX_LINKS; i += 1)
    expect(
      (await link('live', { url: `https://x.example/${i}` })).isError,
    ).toBe(false)
  const { isError, data } = await link('live', { url: 'https://x.example/11' })
  expect(isError).toBe(true)
  expect(data.error).toBe('links_full')
  expect(await linksOf('live')).toHaveLength(MAX_LINKS)
})

test('F23-AC20: Given another author’s slide and an unknown one, When the three tools name them, Then both are refused alike and nothing is written', async () => {
  const calls: [string, Record<string, unknown>][] = [
    ['put_article_draft', { body: 'x' }],
    [
      'add_related_link',
      { kind: 'other', url: 'https://x.example/', title: 't' },
    ],
    ['remove_related_link', { linkId: 'abc' }],
  ]
  for (const [name, args] of calls) {
    const foreign = await callTool(client, name, { slide: 'secret', ...args })
    const unknown = await callTool(client, name, { slide: 'nope', ...args })
    expect(foreign).toEqual(unknown)
    expect(foreign.isError).toBe(true)
    expect(foreign.data.error).toBe('unknown_slide')
  }
  expect(await readArticle(database, 'bobs')).toBeNull()
  expect(await linksOf('secret')).toEqual([])
})

test('F23-AC21: Given the tool list, When its names are read, Then there is no tool that publishes or unpublishes an article', async () => {
  const { tools } = await client.listTools()
  const names = tools.map((tool) => tool.name)
  expect(names).toEqual(
    expect.arrayContaining([
      'put_article_draft',
      'add_related_link',
      'remove_related_link',
    ]),
  )
  expect(names.filter((name) => /publish|unpublish/i.test(name))).toEqual([])
})

test('F23-AC23: Given the tool descriptions, When they are read, Then they say the draft cannot be published, the limit, and how a page is embedded', async () => {
  const { tools } = await client.listTools()
  const description = (name: string) =>
    tools.find((tool) => tool.name === name)?.description ?? ''
  const article = description('put_article_draft')
  expect(article).toContain('cannot publish')
  expect(article).toContain('50,000')
  expect(article).toContain('page number')
  expect(article).toContain('alone on a line')
  expect(description('add_related_link')).toContain('https:')
})

test('F23-AC14: Given the author publishes after the tool looked, When the draft is written, Then the write is refused in the same statements and the article and its citations stay', async () => {
  await seedDeck(database, 'race', OWNER_ID)
  const citation = { handle: 'bob', slug: 'secret', page: 2 }
  await keepArticle(database, {
    deckId: 'race',
    body: 'Public text',
    status: 'published',
    citations: [citation],
    now: 1,
  })
  const kept = await keepArticle(database, {
    deckId: 'race',
    body: 'Late draft',
    status: 'draft',
    citations: [],
    now: 2,
    unlessPublished: true,
  })
  expect(kept).toBe('not_kept')
  expect(await readArticle(database, 'race')).toMatchObject({
    status: 'published',
    body: 'Public text',
  })
  expect(
    await db
      .select()
      .from(articleCitations)
      .where(eq(articleCitations.deck_id, 'race')),
  ).toHaveLength(1)
  // A draft is still written, and a new article too.
  await keepArticle(database, {
    deckId: 'race',
    body: 'x',
    status: 'draft',
    citations: [],
    now: 3,
  })
  const again = await keepArticle(database, {
    deckId: 'race',
    body: 'Second draft',
    status: 'draft',
    citations: [],
    now: 4,
    unlessPublished: true,
  })
  expect(again).toBe('kept')
  expect(await readArticle(database, 'race')).toMatchObject({
    body: 'Second draft',
  })
})

let titlesSeeded = false
beforeEach(async () => {
  if (titlesSeeded) return
  titlesSeeded = true
  await seedDeck(database, 'titles', OWNER_ID)
})

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

test('F27-AC41: Given add_related_link without a title, When it is called, Then the link is added with no title, reported as none, and no request leaves the service', async () => {
  const url = 'https://blog.example/mcp-none'
  let result: Awaited<ReturnType<typeof callTool>> | undefined
  const asked = await outside(async () => {
    result = await callTool(client, 'add_related_link', {
      slide: 'titles',
      kind: 'article',
      url,
    })
  })
  expect(result?.isError).toBe(false)
  expect(result?.data.titleSource).toBe('none')
  const links = result?.data.links as { url: string; title: string | null }[]
  expect(links.find((link) => link.url === url)?.title).toBeNull()
  expect(result?.data.nextStep).toEqual(expect.stringContaining('site name'))
  expect(asked).toEqual([])
})

test('F27-AC41: Given add_related_link with a title, When it is called, Then the title is used and reported as given', async () => {
  const url = 'https://blog.example/mcp-given-title'
  const { data } = await callTool(client, 'add_related_link', {
    slide: 'titles',
    kind: 'other',
    url,
    title: 'Mine',
  })
  expect(data.titleSource).toBe('given')
  expect(
    (data.links as { url: string; title: string | null }[]).find(
      (link) => link.url === url,
    )?.title,
  ).toBe('Mine')
})

test('F27-AC41: Given the tool list, When add_related_link is read, Then title is optional and the description says the page is never read', async () => {
  const tool = (await client.listTools()).tools.find(
    (one) => one.name === 'add_related_link',
  )
  const schema = tool?.inputSchema as { required?: string[] }
  expect(schema.required).not.toContain('title')
  expect(tool?.description).toContain('titleSource')
  expect(tool?.description).toContain('never reads the linked page')
})

test('F27-AC41: Given add_related_link whose title is not text, When it is called through the service, Then it is refused and nothing is added', async () => {
  const { addRelatedLink } = await import('./article-api')
  const before = (await linksOf('titles')).length
  const result = await addRelatedLink(
    { env, ownerUserId: OWNER_ID },
    'titles',
    { kind: 'other', url: 'https://blog.example/nontext', title: 5 },
  )
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result.content)).toContain('link_title_invalid')
  expect((await linksOf('titles')).length).toBe(before)
})

test.each([
  ['a YouTube address', 'https://www.youtube.com/watch?v=mcp', 'video'],
  ['a Zenn address', 'https://zenn.dev/x/articles/mcp', 'article'],
  ['an address not told apart', 'https://example.com/mcp-kind', 'other'],
])(
  'F27-AC36: Given add_related_link without a kind and %s, When it is called, Then the kind is read from the address',
  async (_name, url, kind) => {
    const { isError, data } = await callTool(client, 'add_related_link', {
      slide: 'titles',
      url,
      title: 'Kept as typed',
    })
    expect(isError).toBe(false)
    expect(
      (data.links as { url: string; kind: string }[]).find(
        (link) => link.url === url,
      )?.kind,
    ).toBe(kind)
  },
)

test('F27-AC36: Given add_related_link with a kind and an address of another kind, When it is called, Then the kind given is used', async () => {
  const url = 'https://www.youtube.com/watch?v=given'
  const { data } = await callTool(client, 'add_related_link', {
    slide: 'titles',
    kind: 'other',
    url,
    title: 'T',
  })
  expect(
    (data.links as { url: string; kind: string }[]).find(
      (link) => link.url === url,
    )?.kind,
  ).toBe('other')
})

test('F27-AC36: Given the tool list, When add_related_link is read, Then kind is optional and the description says it is read from the address', async () => {
  const tool = (await client.listTools()).tools.find(
    (one) => one.name === 'add_related_link',
  )
  expect((tool?.inputSchema as { required?: string[] }).required).not.toContain(
    'kind',
  )
  expect(tool?.description).toContain('reads it from the address')
})
