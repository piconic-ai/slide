import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { articles, decks, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  INVITED_ID,
  resetTables,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { keepArticle } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let owner = ''
let reader = ''
let talk = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  owner = await signIn(env)
  reader = await signIn(env, 'reader', { id: INVITED_ID, name: 'Reader' })
  talk = await seedPublic(db, 'talk', 1, 'Talk')
})
afterAll(() => platform.dispose())

const open = (path: string, cookie = '', lang = 'ja') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: { Cookie: cookie, 'Accept-Language': lang },
    }),
    env,
  )
const viewer = async (path = '/@owner/talk', cookie = '', lang = 'ja') =>
  (await open(path, cookie, lang)).text()

const write = (
  body: string,
  status: 'draft' | 'published' = 'published',
  deck = 'talk',
) => keepArticle(db, { deckId: deck, body, status, citations: [], now: 5 })

/** The article's section of the viewer; null when the page has none. */
const sectionOf = (page: string) =>
  /<section\s+class="viewer-article"\s+data-viewer-article[^>]*>([\s\S]*?)<\/section>/.exec(
    page,
  )?.[1] ?? null

test('F26-AC78: Given a published article, When a signed-out reader opens the viewer, Then the article stands under the slides with no heading of its own', async () => {
  await write('# 話したこと\n\n本文です。')
  const page = await viewer()
  const section = sectionOf(page)
  expect(section).not.toContain('<h2')
  expect(page).not.toContain('id="article"')
  expect(page).toMatch(/data-viewer-article\s+aria-label="記事"/)
  expect(section).toContain('<h3>話したこと</h3>')
  expect(section).toContain('<p>本文です。</p>')
  expect(section).not.toContain('下書き')
  // Under the slides and the author's side, which holds the description.
  expect(page.indexOf('data-viewer-article')).toBeGreaterThan(
    page.indexOf('<iframe'),
  )
  expect(page.indexOf('data-viewer-article')).toBeGreaterThan(
    page.indexOf('class="viewer-side"'),
  )
})

test('F26-AC78: Given English, When a reader opens the viewer, Then the section is named Article and has no heading', async () => {
  await write('hello')
  const page = await viewer('/@owner/talk', '', 'en')
  expect(page).toMatch(/data-viewer-article\s+aria-label="Article"/)
  expect(sectionOf(page)).not.toContain('<h2')
})

test('F26-AC2: Given a draft, When its author opens the viewer, Then the article shows as readers will see it, with the tag Draft above the text', async () => {
  await write('# Draft text', 'draft')
  const section = sectionOf(await viewer('/@owner/talk', owner))
  expect(section).toContain('<h3>Draft text</h3>')
  expect(section).toContain('status-draft')
  expect(section).toContain('下書き')
})

test('F26-AC3, F26-AC32: Given a draft, When a signed-out reader and another signed-in author open the viewer, Then no section of the article is there, and nothing of it', async () => {
  await write('secret draft text', 'draft')
  for (const cookie of ['', reader]) {
    const page = await viewer('/@owner/talk', cookie)
    expect(sectionOf(page)).toBeNull()
    expect(page).not.toContain('data-viewer-article')
    expect(page).not.toContain('secret draft text')
    expect(page).not.toContain('id="article"')
  }
})

test('F26-AC32: Given no article and an article with nothing in it, When the viewer opens, Then there is no section for the article', async () => {
  expect(sectionOf(await viewer())).toBeNull()
  await write('   \n', 'published')
  const page = await viewer('/@owner/talk', owner)
  expect(page).not.toContain('data-viewer-article')
})

test('F26-AC5: Given a published article under slides that are not public, When a reader opens the viewer, Then the slides are not available and nothing of the article shows, while the author sees both', async () => {
  await write('# Only for now\n\nprivate words')
  await orm
    .update(decks)
    .set({ public_deployment_id: null })
    .where(eq(decks.id, 'talk'))
  for (const cookie of ['', reader]) {
    const response = await open('/@owner/talk', cookie)
    expect(response.status).toBe(404)
    const page = await response.text()
    expect(page).not.toContain('private words')
    expect(page).not.toContain('data-viewer-article')
  }
  const version = await seedDeployment(db, 'talk')
  const preview = await viewer(`/@owner/talk?v=${version}`, owner)
  expect(sectionOf(preview)).toContain('private words')
})

test('F26-AC79: Given a published article, When it is unpublished, Then the next reader sees none', async () => {
  await write('words', 'published')
  expect(sectionOf(await viewer())).toContain('words')
  await write('words', 'draft')
  expect(sectionOf(await viewer())).toBeNull()
})

test('F26-AC7: Given a published article, When it is edited and saved, Then the next reader sees the new text at once', async () => {
  await write('old text')
  expect(sectionOf(await viewer())).toContain('old text')
  await write('new text')
  const section = sectionOf(await viewer())
  expect(section).toContain('new text')
  expect(section).not.toContain('old text')
})

test('F26-AC8: Given a published article, When a new version of the slides is published, Then the article is still there', async () => {
  await write('stays')
  const next = await seedDeployment(db, 'talk')
  await orm
    .update(decks)
    .set({ public_deployment_id: next })
    .where(eq(decks.id, 'talk'))
  expect(talk).not.toBe(next)
  expect(sectionOf(await viewer())).toContain('stays')
})

test('F26-AC15: Given an article, When the viewer is answered, Then the article is in the management origin’s page, under the same policy that frames only the deck’s own origin', async () => {
  await write('words')
  const response = await open('/@owner/talk')
  const policy = response.headers.get('content-security-policy') ?? ''
  expect(policy).toContain("script-src 'self'")
  expect(policy).toContain('frame-src https://d-')
  expect(policy).not.toContain('unsafe-eval')
  const page = await response.text()
  // The article is outside the frame that holds the author's HTML.
  const frame = /<iframe[\s\S]*?<\/iframe>/.exec(page)?.[0] ?? ''
  expect(frame).toContain('sandbox="allow-scripts allow-same-origin"')
  expect(frame).not.toContain('words')
  expect(page).toContain('words')
})

test('F26-AC10: Given every kind of Markdown, When the viewer shows the article, Then each kind comes out as its element', async () => {
  await write(
    [
      '# H1',
      'para with **strong** and *em* and ~~gone~~ and `code`',
      '- one\n- two',
      '> quoted',
      '```\nlet x = 1 < 2\n```',
      '| a | b |\n|---|---|\n| 1 | 2 |',
      'auto https://example.com/x link',
    ].join('\n\n'),
  )
  const section = sectionOf(await viewer()) ?? ''
  for (const expected of [
    '<h3>H1</h3>',
    '<strong>strong</strong>',
    '<em>em</em>',
    '<s>gone</s>',
    '<code>code</code>',
    '<ul>',
    '<blockquote>',
    '<pre><code>let x = 1 &lt; 2\n</code></pre>',
    '<table>',
    '<a href="https://example.com/x" rel="noopener nofollow ugc">https://example.com/x</a>',
  ])
    expect(section).toContain(expected)
})

test('F26-AC11, F26-AC12, F26-AC13, F26-AC14: Given hostile text, When the viewer shows the article, Then script, iframe, form, handlers, style attributes and javascript links are not in the HTML, and raw HTML shows as text', async () => {
  await write(
    [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<iframe src="https://evil.example"></iframe>',
      '<form action="https://evil.example"><input name=p></form>',
      '<div style="position:fixed;inset:0">cover</div>',
      '<a href="javascript:alert(1)" onclick="alert(1)">x</a>',
      '[y](javascript:alert(2))',
      '[z](https://example.com/ "t")',
      '<svg onload=alert(1)>',
    ].join('\n\n'),
  )
  // The section ends with the service's own style; the text is what precedes it.
  const section = (sectionOf(await viewer()) ?? '').split('<style>')[0] ?? ''
  expect(section).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(section).toContain(
    '&lt;div style=&quot;position:fixed;inset:0&quot;&gt;cover',
  )
  const tags = section.match(/<[^>]*>/g) ?? []
  for (const tag of tags) {
    expect(tag).not.toMatch(/^<\/?(script|iframe|form|input|img|svg|style)\b/i)
    expect(tag).not.toMatch(/\s(on[a-z]+|style)\s*=/i)
    expect(tag).not.toMatch(/javascript:/i)
  }
  expect(section).toContain(
    '<a href="https://example.com/" rel="noopener nofollow ugc">z</a>',
  )
  // The page around it still runs only the service's own script.
  const scripts = (await viewer()).match(/<script\b[^>]*>/g) ?? []
  for (const script of scripts)
    expect(script).toMatch(/src="\/(share\.js|components\/)/)
})

test('F26-AC17: Given a paragraph of only the article’s own page 3 URL, When the viewer shows it, Then the page image stands there as a link that moves the slides', async () => {
  await write(`${TEST_ORIGIN}/@owner/talk/3`)
  const section = sectionOf(await viewer()) ?? ''
  expect(section).toContain('class="article-embed"')
  expect(section).toContain('href="/@owner/talk/3"')
  expect(section).toContain('data-article-page="3"')
  expect(section).toContain(
    'class="deck-cover-name" aria-hidden="true">3</span>',
  )
  // Every version has its pages taken (F05-AC23).
  expect(section).toContain(`src="/covers/${talk}/3.jpg"`)
  expect(section).toContain('3 ページ · 押すとスライドがこのページに移る')
})

test('F26-AC19, F26-AC20: Given the URL of a page of another author’s public slides, When the viewer shows it, Then the page image names the author, the title and the page, and opens that page', async () => {
  await seedPublic(db, 'open', 2, 'Open deck', INVITED_ID)
  await write(`${TEST_ORIGIN}/@reader/open/5`)
  const section = sectionOf(await viewer()) ?? ''
  expect(section).toContain('class="article-embed"')
  expect(section).toContain('href="/@reader/open/5"')
  expect(section).toContain('Readerさんの『Open deck』5 ページ')
  expect(section).toContain(
    'class="deck-cover-name" aria-hidden="true">Open deck · 5</span>',
  )
  expect(section).not.toContain('data-article-page')
  const en = sectionOf(await viewer('/@owner/talk', '', 'en')) ?? ''
  expect(en).toContain('“Open deck” by Reader, page 5')
})

test('F26-AC21: Given a share URL in a sentence, When the viewer shows it, Then it is a plain link, not an image', async () => {
  await seedPublic(db, 'open', 2, 'Open deck', INVITED_ID)
  await write(`Read ${TEST_ORIGIN}/@reader/open/5 for more.`)
  const section = sectionOf(await viewer()) ?? ''
  expect(section).not.toContain('article-embed')
  expect(section).toContain(`<a href="${TEST_ORIGIN}/@reader/open/5"`)
})

test('F26-AC22: Given URLs of slides that are not public in each way, When the viewer shows the article, Then no image, title or author appears, and each URL is a plain link', async () => {
  // Never published, paused, deleted, hidden by an operator, and by a stopped author.
  await orm.insert(decks).values([
    { id: 'draft', slug: 'draft', owner_user_id: INVITED_ID, created_at: 1 },
    { id: 'paused', slug: 'paused', owner_user_id: INVITED_ID, created_at: 1 },
  ])
  await seedDeployment(db, 'draft')
  const pausedVersion = await seedDeployment(db, 'paused')
  await orm
    .update(decks)
    .set({ paused_at: 5, resume_deployment_id: pausedVersion })
    .where(eq(decks.id, 'paused'))
  await seedPublic(db, 'hidden', 3, 'Hidden deck title', INVITED_ID)
  await applyOperatorCommand(db, {
    deckId: 'hidden',
    command: { kind: 'hide', reason: 'spam', operator: 'op' },
    now: 5,
  })
  await signIn(env, 'stopped', { id: '555', name: 'Stopped person' })
  await seedPublic(db, 'by-stopped', 4, 'Stopped deck title', '555')
  await orm.insert(suspensions).values({
    user_id: '555',
    reason: 'spam',
    suspended_at: 5,
    suspended_by: 'op',
  })
  await write(
    [
      `${TEST_ORIGIN}/@reader/draft/2`,
      `${TEST_ORIGIN}/@reader/paused/2`,
      `${TEST_ORIGIN}/@reader/hidden/2`,
      `${TEST_ORIGIN}/@stopped/by-stopped/2`,
      `${TEST_ORIGIN}/@reader/nothing/2`,
      `${TEST_ORIGIN}/@nobody/nothing/2`,
    ].join('\n\n'),
  )
  const page = await viewer()
  const section = sectionOf(page) ?? ''
  expect(section).not.toContain('article-embed')
  expect(section.match(/<a href=/g)).toHaveLength(6)
  for (const secret of [
    'Hidden deck title',
    'Stopped deck title',
    'Stopped person',
  ])
    expect(page).not.toContain(secret)
})

test('F26-AC22: Given a URL of a page of slides that are private and one that does not exist, When the viewer shows them, Then the two read the same, so nothing tells which exists', async () => {
  await orm.insert(decks).values({
    id: 'private',
    slug: 'private',
    owner_user_id: INVITED_ID,
    created_at: 1,
  })
  await seedDeployment(db, 'private')
  await write(`${TEST_ORIGIN}/@reader/private/2`)
  const a = (sectionOf(await viewer()) ?? '').replaceAll('private', 'X')
  await write(`${TEST_ORIGIN}/@reader/nowhere/2`)
  const b = (sectionOf(await viewer()) ?? '').replaceAll('nowhere', 'X')
  expect(a).toBe(b)
})

test('F26-AC17: Given more pages than the limit, When the viewer shows them, Then the first twenty are images and the rest are plain links', async () => {
  await write(
    Array.from(
      { length: 25 },
      (_, index) => `${TEST_ORIGIN}/@owner/talk/${index + 1}`,
    ).join('\n\n'),
  )
  const section = sectionOf(await viewer()) ?? ''
  expect(section.match(/class="article-embed"/g)).toHaveLength(20)
  expect(section.match(/<p><a href=/g)).toHaveLength(5)
})

test('F26-AC78: Given an article saved with the limit, When the viewer shows it, Then it answers with a body of at most 50,000 characters of its own text', async () => {
  await write('a'.repeat(50_000))
  const response = await open('/@owner/talk')
  expect(response.status).toBe(200)
  expect(sectionOf(await response.text())).toContain('a'.repeat(50_000))
})

test('F26-AC27: Given the article row of another author’s slides, When this author’s viewer opens, Then it shows only this deck’s article', async () => {
  await seedPublic(db, 'other', 3, 'Other', INVITED_ID)
  await write('theirs only', 'published', 'other')
  await write('mine', 'published', 'talk')
  const section = sectionOf(await viewer()) ?? ''
  expect(section).toContain('mine')
  expect(section).not.toContain('theirs only')
  expect(await orm.select().from(articles)).toHaveLength(2)
  expect(reader).not.toBe('')
})
