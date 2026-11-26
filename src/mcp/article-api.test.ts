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
import {
  nextFields,
  type ArticleFields,
  type ArticleState,
} from '../articles/article'
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
import { putArticleDraft } from './article-api'
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

let fresh = 0
/**
 * A new slide of the author's whose article is in the state, put there by
 * the store's own writes: a draft holds DRAFT, a published article
 * PUBLISHED, and its working draft AUTHOR-EDIT.
 */
async function slideWith(state: ArticleState) {
  fresh += 1
  const slug = `art${fresh}`
  await seedDeck(database, slug, OWNER_ID)
  if (state === 'none') return slug
  await keepArticle(database, {
    deckId: slug,
    body: state === 'draft' ? 'DRAFT' : 'PUBLISHED',
    status: state === 'draft' ? 'draft' : 'published',
    citations: [],
    now: 1,
  })
  if (state === 'pending')
    await autosaveArticle(database, {
      deckId: slug,
      body: 'AUTHOR-EDIT',
      known: (await readArticle(database, slug))!.revision,
      now: 2,
    })
  return slug
}
const fieldsOf = async (slug: string): Promise<ArticleFields | null> => {
  const row = await readArticle(database, slug)
  return row && { body: row.body, draftBody: row.draftBody, status: row.status }
}
const revisionOf = async (slug: string) =>
  (await readArticle(database, slug))?.revision ?? null
const read = (slide: string) => callTool(client, 'get_article_draft', { slide })
const write = (slide: string, body: string, revision?: unknown) =>
  callTool(client, 'put_article_draft', {
    slide,
    body,
    ...(revision === undefined ? {} : { revision }),
  })
const anonymous = (path: string) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)
const authorGet = page
const authorPost = (path: string, fields: Record<string, string>) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Cookie: alice,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )
const authorAutosave = (slug: string, body: string, revision: number) =>
  authorPost(`/my/slides/${slug}/article/autosave`, {
    body,
    revision: String(revision),
  })
const pagesOf = (slug: string) => ({
  editUrl: `${TEST_ORIGIN}/my/slides/${slug}/article`,
  manageUrl: `${TEST_ORIGIN}/my/slides/${slug}`,
})

test('F23-AC25: Given a slide without an article, When get_article_draft reads it, Then it says there is none and that writing makes a new draft', async () => {
  const slug = await slideWith('none')
  const { isError, data } = await read(slug)
  expect(isError).toBe(false)
  expect(data).toEqual({
    slide: slug,
    state: 'none',
    revision: null,
    body: null,
    publishedBody: null,
    relatedLinks: [],
    ...pagesOf(slug),
    nextStep: expect.stringMatching(/without revision.*draft/),
  })
  expect(await readArticle(database, slug)).toBeNull()
})

test.each([
  ['F23-AC26', 'draft', 'DRAFT', 'draft'],
  ['F23-AC27', 'published', 'PUBLISHED', 'published'],
  ['F23-AC27', 'pending', 'AUTHOR-EDIT', 'published_with_changes'],
] as const)(
  '%s, F23-AC28: Given a %s article, When get_article_draft reads it, Then the text being edited, the state, the revision and the article page come back, and nothing is written',
  async (_, state, body, shown) => {
    const slug = await slideWith(state)
    const before = await readArticle(database, slug)
    const { isError, data } = await read(slug)
    expect(isError).toBe(false)
    expect(data).toEqual({
      slide: slug,
      state: shown,
      revision: before!.revision,
      body,
      // What readers see: the text of a published article, none for a draft.
      publishedBody: state === 'draft' ? null : 'PUBLISHED',
      relatedLinks: [],
      ...pagesOf(slug),
      nextStep: expect.stringContaining('this revision'),
    })
    expect(await readArticle(database, slug)).toEqual(before)
  },
)

test.each([
  ['none', 'NEW', 'draft', 'Publish the article'],
  ['draft', 'NEW', 'draft', 'Publish the article'],
  ['draft', '', 'draft', 'Publish the article'],
  ['published', 'NEW', 'published_with_changes', 'Update published article'],
  ['pending', 'NEW', 'published_with_changes', 'Update published article'],
  ['pending', 'PUBLISHED', 'published', 'no change waits'],
  ['published', 'PUBLISHED', 'published', 'no change waits'],
  ['published', '', 'published_with_changes', 'Update published article'],
] as const)(
  'F23-AC29, F23-AC30, F23-AC31, F23-AC33, F23-AC37: Given a %s article, When put_article_draft writes “%s” at the revision read, Then it holds what the editing page’s autosave makes of it, and the new revision, the state, the pages and the next step come back',
  async (state, body, shown, step) => {
    const slug = await slideWith(state)
    const before = await fieldsOf(slug)
    const known = (await read(slug)).data.revision as number | null
    const { isError, data } = await write(slug, body, known ?? undefined)
    expect(isError).toBe(false)
    const revision = await revisionOf(slug)
    expect(revision).toBe(known === null ? 1 : known + 1)
    expect(data).toEqual({
      slide: slug,
      state: shown,
      revision,
      ...pagesOf(slug),
      nextStep: expect.stringContaining(step),
    })
    expect(await fieldsOf(slug)).toEqual(nextFields(before, 'autosave', body))
    // What the agent wrote is what it reads back, at the new revision.
    expect((await read(slug)).data).toMatchObject({ body, revision })
    // A write holds no citations of its own.
    expect(
      await db
        .select()
        .from(articleCitations)
        .where(eq(articleCitations.deck_id, slug)),
    ).toEqual([])
  },
)

test('F23-AC31: Given a published article written by the agent, When the author opens its editing page, Then the box holds the agent’s text and the state says changes are not shown', async () => {
  const slug = await slideWith('published')
  await write(slug, 'AGENT-TEXT', await revisionOf(slug))
  const page = await (await authorGet(`/my/slides/${slug}/article`)).text()
  expect(page).toContain('AGENT-TEXT')
  expect(page).toContain('未反映の変更あり')
})

test.each(['draft', 'published', 'pending'] as const)(
  'F23-AC34: Given a %s article, When put_article_draft is called without a revision, Then it is refused, pointing to get_article_draft, and the article is unchanged',
  async (state) => {
    const slug = await slideWith(state)
    const before = await readArticle(database, slug)
    const { isError, data } = await write(slug, 'OVERWRITE')
    expect(isError).toBe(true)
    expect(data).toEqual({
      error: 'revision_required',
      message: expect.stringContaining('get_article_draft'),
    })
    expect(await readArticle(database, slug)).toEqual(before)
  },
)

test.each([
  ['none', () => 0],
  ['none', () => 1],
  ['draft', (known: number) => known - 1],
  ['draft', (known: number) => known + 1],
  ['published', (known: number) => known - 1],
  ['published', (known: number) => known + 1],
  ['pending', (known: number) => known - 1],
  ['pending', () => 0],
] as const)(
  'F23-AC35: Given a %s article, When put_article_draft passes a revision it is not at, Then it is refused, pointing to get_article_draft, and the article is unchanged',
  async (state, other) => {
    const slug = await slideWith(state)
    const before = await readArticle(database, slug)
    const { isError, data } = await write(
      slug,
      'OVERWRITE',
      other(before?.revision ?? 0),
    )
    expect(isError).toBe(true)
    expect(data).toEqual({
      error: 'revision_mismatch',
      message: expect.stringContaining('get_article_draft'),
    })
    expect(await readArticle(database, slug)).toEqual(before)
  },
)

test('F23-AC35: Given the agent read a working draft, When the author saves after that, Then the agent’s write at the old revision is refused and the author’s text stays; reading again lets it write', async () => {
  const slug = await slideWith('pending')
  const known = (await read(slug)).data.revision as number
  const saved = await authorAutosave(slug, 'AUTHOR-LATER', known)
  expect(saved.status).toBe(200)
  const refused = await write(slug, 'AGENT', known)
  expect(refused.data.error).toBe('revision_mismatch')
  expect(await fieldsOf(slug)).toMatchObject({ draftBody: 'AUTHOR-LATER' })
  const again = await read(slug)
  expect(again.data.body).toBe('AUTHOR-LATER')
  const written = await write(
    slug,
    'AUTHOR-LATER and AGENT',
    again.data.revision,
  )
  expect(written.isError).toBe(false)
  expect(await fieldsOf(slug)).toMatchObject({
    body: 'PUBLISHED',
    draftBody: 'AUTHOR-LATER and AGENT',
  })
})

/**
 * A D1 that runs `interleave` once, right before the first statement that
 * matches `writes`: a save landing between the tool's look and its write.
 */
function racing(
  writes: RegExp,
  interleave: () => Promise<unknown>,
): D1Database {
  let pending = true
  const before = async () => {
    if (!pending) return
    pending = false
    await interleave()
  }
  const late = (bound: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(bound, {
      get(target, name) {
        const value = Reflect.get(target, name) as unknown
        if (typeof value !== 'function') return value
        if (!['all', 'raw', 'run', 'first'].includes(String(name)))
          return value.bind(target)
        return async (...args: unknown[]) => {
          await before()
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      },
    })
  return new Proxy(database, {
    get(target, property) {
      if (property !== 'prepare') return Reflect.get(target, property)
      return (query: string) => {
        const statement = target.prepare(query)
        if (!writes.test(query)) return statement
        return new Proxy(statement, {
          get(inner, name) {
            if (name === 'bind')
              return (...values: unknown[]) => late(inner.bind(...values))
            const value = Reflect.get(inner, name) as unknown
            return typeof value === 'function' ? value.bind(inner) : value
          },
        })
      }
    },
  })
}

test.each(['draft', 'published', 'pending'] as const)(
  'F23-AC35: Given a %s article the author saves between the tool’s look and its write, When put_article_draft writes at the revision read, Then the write is refused in the same statement and the author’s save stays',
  async (state) => {
    const slug = await slideWith(state)
    const known = (await revisionOf(slug))!
    const result = await putArticleDraft(
      {
        env: {
          ...env,
          DB: racing(/^update "articles"/i, () =>
            autosaveArticle(database, {
              deckId: slug,
              body: 'AUTHOR-RACE',
              known,
              now: 5,
            }),
          ),
        },
        ownerUserId: OWNER_ID,
      },
      slug,
      'AGENT',
      known,
    )
    expect(result.isError).toBe(true)
    expect(result.structuredContent.error).toBe('revision_mismatch')
    expect(await revisionOf(slug)).toBe(known + 1)
    expect(JSON.stringify(await fieldsOf(slug))).toContain('AUTHOR-RACE')
    expect(JSON.stringify(await fieldsOf(slug))).not.toContain('AGENT')
  },
)

test('F23-AC35: Given a slide without an article that the author starts between the tool’s look and its write, When put_article_draft writes without a revision, Then it is refused and the author’s draft stays', async () => {
  const slug = await slideWith('none')
  const result = await putArticleDraft(
    {
      env: {
        ...env,
        DB: racing(/^insert into "articles"/i, () =>
          autosaveArticle(database, {
            deckId: slug,
            body: 'AUTHOR-FIRST',
            known: null,
            now: 5,
          }),
        ),
      },
      ownerUserId: OWNER_ID,
    },
    slug,
    'AGENT',
    undefined,
  )
  expect(result.structuredContent.error).toBe('revision_mismatch')
  expect(await readArticle(database, slug)).toMatchObject({
    body: 'AUTHOR-FIRST',
    revision: 1,
  })
})

test.each(['draft', 'published'] as const)(
  'F23-AC36, F26-AC88: Given the author’s editing page open on a %s article, When the agent writes and the page then saves, Then the revision has moved, the page’s save is refused and its next draw stops autosaving, and the agent’s text stays',
  async (state) => {
    const slug = await slideWith(state)
    const opened = await (await authorGet(`/my/slides/${slug}/article`)).text()
    const loaded = Number(/name="revision"\s+value="([^"]*)"/.exec(opened)?.[1])
    expect(loaded).toBe(await revisionOf(slug))
    const { data } = await write(slug, 'AGENT-TEXT', loaded)
    expect(data.revision).toBe(loaded + 1)
    const autosaved = await authorAutosave(slug, 'author typing', loaded)
    expect(autosaved.status).toBe(409)
    const drawn = await (
      await authorPost(`/my/slides/${slug}/article`, {
        action: 'write',
        body: 'author typing',
        revision: String(loaded),
      })
    ).text()
    expect(drawn).toContain('data-stopped="true"')
    expect(drawn).toContain('別のタブで更新されています')
    expect(JSON.stringify(await fieldsOf(slug))).toContain('AGENT-TEXT')
  },
)

test('F23-AC32, F26-AC95: Given a public slide with a published article that cites a page, When the agent writes a change with other words and another citation, Then readers’ viewer, the citations and the profile lists stay as they were until the author updates the publication', async () => {
  fresh += 1
  const slug = `pub${fresh}`
  await seedPublic(database, slug, 100, 'Public talk', OWNER_ID)
  await keepArticle(database, {
    deckId: slug,
    body: `PUBLIC-WORDS\n\n${TEST_ORIGIN}/@alice/talk/2\n`,
    status: 'published',
    citations: [{ handle: 'alice', slug: 'talk', page: 2 }],
    now: 1,
  })
  const cited = () =>
    db.select().from(articleCitations).where(eq(articleCitations.deck_id, slug))
  const readerPages = [
    `/@alice/${slug}`,
    '/@alice',
    '/@alice/citing',
    '/@alice/cited',
  ]
  const seen = async () =>
    Promise.all(
      readerPages.map(async (path) =>
        (await (await anonymous(path)).text()).replace(
          /nonce="[^"]*"/g,
          'nonce',
        ),
      ),
    )
  const citationsBefore = await cited()
  expect(citationsBefore).toHaveLength(1)
  const pagesBefore = await seen()
  expect(pagesBefore[0]).toContain('PUBLIC-WORDS')
  const { isError, data } = await write(
    slug,
    `AGENT-WORDS\n\n${TEST_ORIGIN}/@alice/live/1\n`,
    await revisionOf(slug),
  )
  expect(isError).toBe(false)
  expect(data.state).toBe('published_with_changes')
  expect(await cited()).toEqual(citationsBefore)
  const pagesAfter = await seen()
  expect(pagesAfter).toEqual(pagesBefore)
  for (const page of pagesAfter) expect(page).not.toContain('AGENT-WORDS')
  // The author's own viewer shows the published text too.
  const own = await (await authorGet(`/@alice/${slug}`)).text()
  expect(own).toContain('PUBLIC-WORDS')
  expect(own).not.toContain('AGENT-WORDS')
})

test.each(['none', 'draft', 'published', 'pending'] as const)(
  'F23-AC17: Given a %s article, When put_article_draft gets 50,001 characters, Then it is refused with the reason and the article is unchanged; 50,000 are kept',
  async (state) => {
    const slug = await slideWith(state)
    const before = await readArticle(database, slug)
    const { isError, data } = await write(
      slug,
      'a'.repeat(MAX_ARTICLE_CHARS + 1),
      before?.revision,
    )
    expect(isError).toBe(true)
    expect(data).toMatchObject({
      error: 'body_too_long',
      message: expect.stringContaining('50000'),
    })
    expect(await readArticle(database, slug)).toEqual(before)
    const ok = await write(
      slug,
      '🙂'.repeat(MAX_ARTICLE_CHARS),
      before?.revision,
    )
    expect(ok.isError).toBe(false)
    expect((await read(slug)).data.body).toHaveLength(MAX_ARTICLE_CHARS * 2)
  },
)

test.each([-1, 1.5, '2', null])(
  'F23-AC34: Given a revision of %s, which is no revision, When put_article_draft is called, Then it is refused and the article is unchanged',
  async (revision) => {
    const slug = await slideWith('published')
    const before = await readArticle(database, slug)
    const { isError } = await write(slug, 'OVERWRITE', revision)
    expect(isError).toBe(true)
    expect(await readArticle(database, slug)).toEqual(before)
  },
)

test('F23-AC15, F23-AC16, F23-AC22: Given an own slide, When a link is added and then removed, Then the manage page shows it and then does not, and the manage URL comes back', async () => {
  const added = await link('talk')
  expect(added.isError).toBe(false)
  expect(added.data).toMatchObject({
    slide: 'talk',
    editUrl: `${TEST_ORIGIN}/my/slides/talk#links`,
    nextStep: expect.stringContaining('manage page'),
    links: [{ kind: 'video', url: 'https://video.example/talk' }],
  })
  for (const path of ['/my/slides/talk', '/@alice/talk'])
    expect(await (await page(path)).text()).toContain('Recording')
  const [{ id }] = (added.data.links as { id: string }[]).slice(-1)
  const removed = await callTool(client, 'remove_related_link', {
    slide: 'talk',
    linkId: id,
  })
  expect(removed.isError).toBe(false)
  expect(removed.data.links).toEqual([])
  expect(await linksOf('talk')).toEqual([])
  for (const path of ['/my/slides/talk', '/@alice/talk'])
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

test.each([
  'https://slide.community@evil.example/',
  'https://user:pass@x.example/',
  'https://:pass@x.example/',
  'https://user@x.example/a?b=1',
])(
  'F23-AC41: Given %s with a user name or password, When add_related_link is called, Then it is refused with the reason and nothing is added',
  async (url) => {
    const { isError, data } = await link('talk', { url })
    expect(isError).toBe(true)
    expect(data.error).toBe('link_url_credentials')
    expect(data.message).toBe(
      'A URL with a user name or password is not taken.',
    )
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

test('F23-AC39: Given a slide with a link, When add_related_link is given an address of the same form, Then it is refused with the reason and the slide keeps one link', async () => {
  expect((await link('talk', { url: 'https://youtu.be/abc' })).isError).toBe(
    false,
  )
  const { isError, data } = await link('talk', {
    url: 'https://www.youtube.com/watch?v=abc&si=x',
    title: 'Another title',
  })
  expect(isError).toBe(true)
  expect(data.error).toBe('link_duplicate')
  expect(data.message).toContain('already has a related link to this address')
  expect(await linksOf('talk')).toHaveLength(1)
})

test('F23-AC40: Given a slide with 10 links, When add_related_link is given an address of the same form as one of them, Then the reason is that it is there already, not the limit', async () => {
  for (let i = (await linksOf('live')).length; i < MAX_LINKS; i += 1)
    expect(
      (await link('live', { url: `https://full.example/${i}` })).isError,
    ).toBe(false)
  const [first] = await linksOf('live')
  const { isError, data } = await link('live', {
    url: `${first!.url.replace('https://', 'https://www.')}#again`,
  })
  expect(isError).toBe(true)
  expect(data.error).toBe('link_duplicate')
  expect(await linksOf('live')).toHaveLength(MAX_LINKS)
})

test('F23-AC20: Given another author’s slide and an unknown one, When the article and link tools name them, Then both are refused alike and nothing is written', async () => {
  const calls: [string, Record<string, unknown>][] = [
    ['get_article_draft', {}],
    ['put_article_draft', { body: 'x' }],
    ['put_article_draft', { body: 'x', revision: 1 }],
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

test('F23-AC20: Given another author’s slide with a published article and a working draft, When the article tools name it, Then neither text comes back and nothing is written', async () => {
  await keepArticle(database, {
    deckId: 'bobs',
    body: 'BOB-PUBLISHED',
    status: 'published',
    citations: [],
    now: 1,
  })
  await autosaveArticle(database, {
    deckId: 'bobs',
    body: 'BOB-EDIT',
    known: (await readArticle(database, 'bobs'))!.revision,
    now: 2,
  })
  const before = await readArticle(database, 'bobs')
  const foreign = await callTool(client, 'get_article_draft', {
    slide: 'secret',
  })
  expect(foreign).toEqual(
    await callTool(client, 'get_article_draft', { slide: 'nope' }),
  )
  expect(JSON.stringify(foreign)).not.toMatch(/BOB-/)
  const written = await callTool(client, 'put_article_draft', {
    slide: 'secret',
    body: 'AGENT',
    revision: before!.revision,
  })
  expect(written.data.error).toBe('unknown_slide')
  expect(await readArticle(database, 'bobs')).toEqual(before)
})

test('F23-AC21: Given the tool list, When its names are read, Then there is no tool that publishes or unpublishes an article', async () => {
  const { tools } = await client.listTools()
  const names = tools.map((tool) => tool.name)
  expect(names).toEqual(
    expect.arrayContaining([
      'get_article_draft',
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

test('F23-AC38: Given the tool descriptions and the server’s instructions, When they are read, Then they say to read before writing, to pass the revision read, and that a published article’s change goes into the working draft readers do not see', async () => {
  const { tools } = await client.listTools()
  const tool = (name: string) => tools.find((one) => one.name === name)
  const reading = tool('get_article_draft')?.description ?? ''
  const writing = tool('put_article_draft')?.description ?? ''
  expect(reading).toContain('Call it before put_article_draft')
  expect(reading).toContain('revision')
  expect(writing).toContain('Read it with get_article_draft first')
  expect(writing).toContain('pass the `revision`')
  expect(writing).toContain('working draft')
  expect(writing).toContain('readers keep seeing the published text')
  expect(writing).toContain('revision_mismatch')
  expect(tool('get_article_draft')?.annotations?.readOnlyHint).toBe(true)
  const schema = tool('put_article_draft')?.inputSchema as {
    required?: string[]
    properties?: Record<string, unknown>
  }
  expect(schema.properties).toHaveProperty('revision')
  expect(schema.required).not.toContain('revision')
  const instructions = client.getInstructions() ?? ''
  expect(instructions).toContain('get_article_draft before writing')
  expect(instructions).toContain('working draft, which readers do not see')
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
