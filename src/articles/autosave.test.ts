import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import {
  articleCitations,
  articles,
  decks,
  previewLaunches,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { markDeckDeleted } from '../decks/deletion-store'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { nextFields, type ArticleAction, type ArticleFields } from './article'
import {
  autosaveArticle,
  discardPendingEdit,
  keepArticle,
  readArticle,
  unpublishArticle,
} from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let owner = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  owner = await signIn(env)
  await signIn(env, 'reader', { id: INVITED_ID, name: 'Reader' })
  await seedPublic(db, 'talk', 1, 'Talk')
})
afterAll(() => platform.dispose())

const fields = async (): Promise<ArticleFields | null> => {
  const row = await readArticle(db, 'talk')
  return row && { body: row.body, draftBody: row.draftBody, status: row.status }
}

/** Puts the article in a state through the store's own writes. */
async function setUp(state: 'none' | 'draft' | 'published' | 'pending') {
  if (state === 'none') return
  await keepArticle(db, {
    deckId: 'talk',
    body: 'p',
    status: state === 'draft' ? 'draft' : 'published',
    citations: [],
    now: 1,
  })
  if (state === 'pending')
    await autosaveArticle(db, {
      deckId: 'talk',
      body: 'e',
      known: (await readArticle(db, 'talk'))!.revision,
      now: 2,
    })
}

/** Runs one action through the store, where one exists for it. */
async function run(action: ArticleAction, sent: string | null) {
  const known = (await readArticle(db, 'talk'))?.revision ?? null
  const input = { deckId: 'talk', now: 3 }
  switch (action) {
    case 'autosave':
      return autosaveArticle(db, { ...input, body: sent ?? '', known })
    case 'publish':
    case 'update':
      return keepArticle(db, {
        ...input,
        body: sent ?? '',
        status: 'published',
        citations: [],
        expectedRevision: known,
      })
    case 'discard':
      return discardPendingEdit(db, { ...input, known: known ?? -1 })
    case 'unpublish':
      return unpublishArticle(db, { ...input, known: known ?? -1 })
  }
}

test.each([
  ['none', 'autosave', 'x'],
  ['draft', 'autosave', 'x'],
  ['published', 'autosave', 'x'],
  ['pending', 'autosave', 'x'],
  ['pending', 'autosave', 'p'],
  ['none', 'publish', 'x'],
  ['draft', 'publish', 'x'],
  ['pending', 'update', 'e'],
  ['pending', 'discard', null],
  ['published', 'discard', null],
  ['pending', 'unpublish', null],
  ['published', 'unpublish', null],
  ['draft', 'unpublish', null],
  ['draft', 'discard', null],
  ['none', 'unpublish', null],
] as const)(
  'F26-AC49, F26-AC54, F26-AC55, F26-AC56: Given %s, When %s is written to D1, Then the row is what the rule says',
  async (state, action, sent) => {
    await setUp(state)
    const before = await fields()
    const expected = nextFields(before, action, sent)
    await run(action, sent)
    expect(await fields()).toEqual(expected ?? before)
  },
)

test('F26-AC49: Given a published article, When the edit is autosaved, Then the revision grows with each write and the published text never moves', async () => {
  await setUp('published')
  const first = await readArticle(db, 'talk')
  const saved = await autosaveArticle(db, {
    deckId: 'talk',
    body: 'e1',
    known: first!.revision,
    now: 5,
  })
  expect(saved).toEqual({
    result: 'saved',
    revision: first!.revision + 1,
    pending: true,
  })
  expect((await readArticle(db, 'talk'))?.body).toBe('p')
})

test('F26-AC57: Given a revision that is behind, When each write is made from it, Then none is kept and the row is as it was', async () => {
  await setUp('pending')
  const row = await readArticle(db, 'talk')
  const behind = row!.revision - 1
  const before = await readArticle(db, 'talk')
  expect(
    await autosaveArticle(db, {
      deckId: 'talk',
      body: 'z',
      known: behind,
      now: 9,
    }),
  ).toEqual({ result: 'conflict' })
  expect(
    await discardPendingEdit(db, { deckId: 'talk', known: behind, now: 9 }),
  ).toBe('not_kept')
  expect(
    await unpublishArticle(db, { deckId: 'talk', known: behind, now: 9 }),
  ).toBe('not_kept')
  expect(
    await keepArticle(db, {
      deckId: 'talk',
      body: 'z',
      status: 'published',
      citations: [{ handle: 'ann', slug: 'deck', page: 1 }],
      now: 9,
      expectedRevision: behind,
    }),
  ).toBe('not_kept')
  expect(await readArticle(db, 'talk')).toEqual(before)
  expect(await orm.select().from(articleCitations)).toEqual([])
})

test('F26-AC58: Given a deck that was deleted, When each write is made, Then no row is made or changed', async () => {
  await markDeckDeleted(db, { deckId: 'talk', ownerUserId: OWNER_ID, now: 10 })
  expect(
    await autosaveArticle(db, {
      deckId: 'talk',
      body: 'x',
      known: null,
      now: 11,
    }),
  ).toEqual({ result: 'conflict' })
  expect(
    await keepArticle(db, {
      deckId: 'talk',
      body: 'x',
      status: 'published',
      citations: [{ handle: 'ann', slug: 'deck', page: 1 }],
      now: 11,
      expectedRevision: null,
    }),
  ).toBe('not_kept')
  expect(await orm.select().from(articles)).toEqual([])
  expect(await orm.select().from(articleCitations)).toEqual([])
})

test('F26-AC58: Given the slides are deleted after an article was made, When an autosave follows from the old screen, Then it changes nothing', async () => {
  await setUp('draft')
  const row = (await readArticle(db, 'talk'))!
  await markDeckDeleted(db, { deckId: 'talk', ownerUserId: OWNER_ID, now: 10 })
  expect(
    await autosaveArticle(db, {
      deckId: 'talk',
      body: 'late',
      known: row.revision,
      now: 11,
    }),
  ).toEqual({ result: 'conflict' })
  expect(await orm.select().from(articles)).toEqual([])
})

const postTo = (path: string, fields: Record<string, string>, cookie = owner) =>
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
const readers = async (path: string, cookie = '') =>
  (
    await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: cookie } }),
      env,
    )
  ).text()

test('F26-AC48: Given a published article with an edit full of marked words, When readers and the author open the viewer, the profile lists, the card lists and the APIs, Then the words are in none of them, and the author sees the published text', async () => {
  await keepArticle(db, {
    deckId: 'talk',
    body: 'PUBLISHED-WORDS',
    status: 'published',
    citations: [],
    now: 1,
  })
  await autosaveArticle(db, {
    deckId: 'talk',
    body: `SECRET-EDIT ${TEST_ORIGIN}/@reader/other`,
    known: (await readArticle(db, 'talk'))!.revision,
    now: 2,
  })
  const reader = await signIn(env, 'reader', { id: INVITED_ID })
  for (const path of [
    '/@owner/talk',
    '/@owner',
    '/@owner/cited',
    '/@owner/citing',
    '/@reader',
    '/@reader/cited',
    '/@reader/citing',
    '/',
    '/api/public/slides',
    '/oembed?url=' + encodeURIComponent(`${TEST_ORIGIN}/@owner/talk`),
    '/embed/@owner/talk',
  ])
    for (const cookie of ['', reader]) {
      const page = await readers(path, cookie)
      expect(
        page,
        `${path} for ${cookie ? 'a reader' : 'nobody'}`,
      ).not.toContain('SECRET-EDIT')
    }
  const own = await readers('/@owner/talk', owner)
  expect(own).toContain('PUBLISHED-WORDS')
  expect(own).not.toContain('SECRET-EDIT')
  // The edit's link is no citation: it is not the published text.
  expect(await orm.select().from(articleCitations)).toEqual([])
})

test('F26-AC48: Given a draft article, When its author opens the viewer, Then they see the draft text and nobody else does', async () => {
  await keepArticle(db, {
    deckId: 'talk',
    body: 'DRAFT-WORDS',
    status: 'draft',
    citations: [],
    now: 1,
  })
  expect(await readers('/@owner/talk', owner)).toContain('DRAFT-WORDS')
  expect(await readers('/@owner/talk')).not.toContain('DRAFT-WORDS')
})

test('F26-AC62, F26-AC58: Given the render endpoint, When the author asks for hostile text, Then the HTML has no script, handler or javascript link, and nothing is saved', async () => {
  const response = await postTo('/slides/talk/article/render', {
    body: [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[x](javascript:alert(1))',
      '# Heading',
    ].join('\n\n'),
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toContain('no-store')
  const html = await response.text()
  expect(html).toContain('data-viewer-article')
  expect(html).toContain('<h3>Heading</h3>')
  expect(html).toContain('&lt;script&gt;')
  for (const tag of html.match(/<[^>]*>/g) ?? []) {
    expect(tag).not.toMatch(/^<\/?(script|iframe|form|img)\b/i)
    expect(tag).not.toMatch(/\son[a-z]+\s*=/i)
    expect(tag).not.toMatch(/javascript:/i)
  }
  expect(await orm.select().from(articles)).toEqual([])
  expect(await orm.select().from(previewLaunches)).toEqual([])
})

test('F26-AC58, F26-AC59: Given the render endpoint, When a text over the limit, no session or a foreign origin is sent, Then it is refused', async () => {
  const long = await postTo('/slides/talk/article/render', {
    body: 'a'.repeat(50_001),
  })
  expect(long.status).toBe(400)
  expect(await long.json()).toEqual({ error: 'too_long' })
  expect(
    (await postTo('/slides/talk/article/render', { body: 'x' }, '')).status,
  ).toBe(401)
  const foreign = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk/article/render`, {
      method: 'POST',
      headers: {
        Cookie: owner,
        Origin: 'https://evil.example',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'body=x',
    }),
    env,
  )
  expect(foreign.status).toBe(403)
  expect(
    (await postTo('/slides/talk/article/render', { body: 'a'.repeat(50_000) }))
      .status,
  ).toBe(200)
})

test('F26-AC60: Given another author’s public page in the text, When it is rendered, Then the embed shows, and one that is not public shows only a link', async () => {
  await seedPublic(db, 'open', 2, 'Open deck', INVITED_ID)
  const html = await (
    await postTo('/slides/talk/article/render', {
      body: `${TEST_ORIGIN}/@reader/open/5\n\n${TEST_ORIGIN}/@reader/nothing/5`,
    })
  ).text()
  expect(html.match(/class="article-embed"/g)).toHaveLength(1)
  expect(html).toContain('Readerさんの『Open deck』5 ページ')
  expect(html).not.toContain('nothing/5" aria-label')
})

test('F26-AC58: Given the editing page as another author, When it is asked to autosave, Then the article of the first is unchanged', async () => {
  await setUp('draft')
  const reader = await signIn(env, 'reader', { id: INVITED_ID })
  const response = await postTo(
    '/slides/talk/article/autosave',
    { body: 'taken', revision: '1' },
    reader,
  )
  expect(response.status).toBe(404)
  expect((await readArticle(db, 'talk'))?.body).toBe('p')
  expect(
    await orm.select().from(decks).where(eq(decks.id, 'talk')),
  ).toHaveLength(1)
})
