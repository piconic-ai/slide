import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { articleCitations, articles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { keepArticle, readArticle } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let cookie = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  cookie = await signIn(env)
  await seedPublic(db, 'talk', 1, 'Talk')
})
afterAll(() => platform.dispose())

const send = (path: string, fields: Record<string, string>, lang = 'ja') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Language': lang,
      },
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )
const form = (fields: Record<string, string>, lang?: string) =>
  send('/slides/talk/article', fields, lang)
const autosave = (body: string, revision: string) =>
  send('/slides/talk/article/autosave', { body, revision })
const stored = async () => (await readArticle(db, 'talk'))!
const hidden = (page: string) =>
  /name="revision"\s+value="([^"]*)"/.exec(page)?.[1]
const boxOf = (page: string) =>
  /<textarea[^>]*>\n?([\s\S]*?)<\/textarea>/.exec(page)?.[1]

/** Tab A loaded the article at revision 1, then tab B saved over it. */
async function twoTabs() {
  await autosave('one', '')
  await autosave('two (tab B)', '1')
  expect((await stored()).revision).toBe(2)
}

test('F26-AC57, F26-AC71: Given a screen that is behind, When it comes back from a write or the preview, Then it keeps the revision it was on, tells it is behind, saves nothing by itself, and the other tab’s text stays', async () => {
  await twoTabs()
  for (const action of ['write', 'preview']) {
    const response = await form({
      action,
      body: 'tab A text',
      revision: '1',
    })
    expect(response.status).toBe(200)
    const page = await response.text()
    if (action === 'write') {
      expect(hidden(page)).toBe('1')
      expect(page).toContain('data-stopped="true"')
      expect(page).toContain('別のタブで更新されています')
      expect(page).toContain('いまの入力はコピーしてから再読み込み')
      expect(boxOf(page)).toBe('tab A text')
    } else {
      // The way back carries the revision the text was written on.
      expect(hidden(page)).toBe('1')
      expect(page).toContain('data-article-preview')
    }
    expect((await stored()).body).toBe('two (tab B)')
    expect((await stored()).revision).toBe(2)
  }
})

test('F26-AC71: Given the preview of a screen that is behind, When the way back is pressed, Then the page is stopped and its revision is the old one, so the next save cannot go through', async () => {
  await twoTabs()
  const preview = await (
    await form({ action: 'preview', body: 'tab A text', revision: '1' })
  ).text()
  const carried = hidden(preview)
  const back = await (
    await form({ action: 'write', body: 'tab A text', revision: carried ?? '' })
  ).text()
  expect(back).toContain('data-stopped="true"')
  expect(hidden(back)).toBe('1')
  // What the page would then send is refused.
  expect((await autosave('tab A text', '1')).status).toBe(409)
  expect((await stored()).body).toBe('two (tab B)')
})

test('F26-AC71: Given a screen that is up to date, When it comes back from the preview, Then it is not stopped, keeps its revision, and the text is for autosave to keep', async () => {
  await autosave('one', '')
  const back = await (
    await form({ action: 'write', body: 'one and more', revision: '1' })
  ).text()
  expect(back).not.toContain('data-stopped="true"')
  expect(back).toContain('data-unsaved="true"')
  expect(hidden(back)).toBe('1')
})

test.each(['', 'abc', '-3'])(
  'F26-AC71: Given a way back with the revision %j that fits no article, When it is sent, Then the page is stopped',
  async (revision) => {
    await autosave('one', '')
    const page = await (
      await form({ action: 'write', body: 'x', revision })
    ).text()
    expect(page).toContain('data-stopped="true"')
  },
)

test('F26-AC57: Given a screen that is behind, When each button is pressed, Then each is refused with the old revision kept on the page, and nothing changes', async () => {
  await twoTabs()
  for (const action of ['publish', 'update', 'discard', 'unpublish']) {
    const response = await form({ action, body: 'tab A', revision: '1' })
    expect(response.status).toBe(409)
    const page = await response.text()
    expect(hidden(page)).toBe('1')
    expect(page).toContain('data-stopped="true"')
  }
  expect(await stored()).toMatchObject({ body: 'two (tab B)', revision: 2 })
})

test('F26-AC71, F23-AC14: Given an agent’s draft kept after the author’s tab loaded, When that tab comes back to editing, Then it is stopped, and the agent’s draft stays', async () => {
  await autosave('author text', '')
  await keepArticle(db, {
    deckId: 'talk',
    body: 'AGENT-DRAFT',
    status: 'draft',
    citations: [],
    now: 9,
    unlessPublished: true,
  })
  const page = await (
    await form({ action: 'write', body: 'author text more', revision: '1' })
  ).text()
  expect(page).toContain('data-stopped="true"')
  expect((await autosave('author text more', '1')).status).toBe(409)
  expect((await stored()).body).toBe('AGENT-DRAFT')
})

/** A published article, as a page without the script would see it. */
async function published(body = 'published text') {
  await keepArticle(db, {
    deckId: 'talk',
    body,
    status: 'published',
    citations: [],
    now: 1,
  })
  return String((await stored()).revision)
}

test('F26-AC66: Given a published article with nothing pending, When “update” is sent with a changed text from a page without the script, Then the text is published and nothing is left pending', async () => {
  const revision = await published()
  const response = await form({
    action: 'update',
    body: 'fixed text',
    revision,
  })
  expect(response.headers.get('Location')).toBe(
    '/slides/talk/article?result=updated',
  )
  expect(await stored()).toMatchObject({
    body: 'fixed text',
    draftBody: null,
    status: 'published',
  })
})

test('F26-AC66: Given a published article, When “update” is sent with the published text and nothing pending, Then nothing is written, not even the revision', async () => {
  const revision = await published()
  const before = await stored()
  const response = await form({
    action: 'update',
    body: 'published text',
    revision,
  })
  expect(response.headers.get('Location')).toBe(
    '/slides/talk/article?result=updated',
  )
  expect(await stored()).toEqual(before)
})

test('F26-AC66: Given a published article without an edit, When “discard” is sent, Then the published text stands and the page opens with it', async () => {
  const revision = await published()
  const response = await form({
    action: 'discard',
    body: 'typed but not kept',
    revision,
  })
  expect(response.headers.get('Location')).toBe(
    '/slides/talk/article?result=discarded',
  )
  expect(await stored()).toMatchObject({
    body: 'published text',
    draftBody: null,
  })
  const page = await (
    await server.fetch(
      new Request(`${TEST_ORIGIN}/slides/talk/article`, {
        headers: { Cookie: cookie },
      }),
      env,
    )
  ).text()
  expect(boxOf(page)).toBe('published text')
})

test('F26-AC67: Given a published article, When “unpublish” is sent with the text in the box, Then that text is the draft’s, even one the page had not saved; with a text over the limit it is refused', async () => {
  const revision = await published()
  const unpublished = await form({
    action: 'unpublish',
    body: 'typed after the last save',
    revision,
  })
  expect(unpublished.headers.get('Location')).toBe(
    '/slides/talk/article?result=unpublished',
  )
  expect(await stored()).toMatchObject({
    body: 'typed after the last save',
    draftBody: null,
    status: 'draft',
  })
  const again = String((await keepAgain()).revision)
  const long = await form({
    action: 'unpublish',
    body: 'a'.repeat(50_001),
    revision: again,
  })
  expect(long.status).toBe(400)
  expect((await stored()).status).toBe('published')
})

async function keepAgain() {
  await keepArticle(db, {
    deckId: 'talk',
    body: 'back',
    status: 'published',
    citations: [],
    now: 3,
  })
  return stored()
}

test('F26-AC67: Given an edit pending and a text sent with “unpublish”, When the revision fits, Then the text sent, not the stored edit, is the draft, and the citations are gone', async () => {
  const revision = await published(`${TEST_ORIGIN}/@ann/deck`)
  await form({ action: 'update', body: `${TEST_ORIGIN}/@ann/deck`, revision })
  const row = await stored()
  await autosave('stored edit', String(row.revision))
  const now = await stored()
  await form({
    action: 'unpublish',
    body: 'newer than the stored edit',
    revision: String(now.revision),
  })
  expect(await stored()).toMatchObject({
    body: 'newer than the stored edit',
    draftBody: null,
    status: 'draft',
  })
  expect(await orm.select().from(articleCitations)).toEqual([])
  expect(
    await orm.select().from(articles).where(eq(articles.deck_id, 'talk')),
  ).toHaveLength(1)
})
