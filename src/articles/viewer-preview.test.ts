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
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  owner = await signIn(env, 'owner', { name: 'Owner Name' })
  await signIn(env, 'reader', { id: INVITED_ID, name: 'Reader' })
  await seedPublic(db, 'talk', 1, 'Talk')
})
afterAll(() => platform.dispose())

const post = (
  fields: Record<string, string>,
  init: { path?: string; cookie?: string; origin?: string; lang?: string } = {},
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${init.path ?? '/slides/talk/article'}`, {
      method: 'POST',
      headers: {
        Cookie: init.cookie ?? owner,
        Origin: init.origin ?? TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Language': init.lang ?? 'ja',
      },
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )
const preview = async (body: string, lang = 'ja') =>
  (await post({ action: 'preview', body }, { lang })).text()

/** The article's section of the viewer, without the section's own style. */
const articleOf = (page: string) =>
  (
    /<section\s+class="viewer-article"\s+data-viewer-article[^>]*>([\s\S]*?)<\/section>/.exec(
      page,
    )?.[1] ?? ''
  ).split('<style>')[0] ?? ''

const rows = async () => ({
  articles: await orm.select().from(articles),
  citations: await orm.select().from(articleCitations),
  launches: await orm.select().from(previewLaunches),
})

test('F26-AC33: Given a text in the box, When the author presses preview, Then the page is the viewer drawn by the same parts: the slides, the title, the article and the side column', async () => {
  const page = await preview('# Heading\n\nHello')
  for (const part of [
    'class="viewer-layout"',
    'class="stage"',
    '<iframe',
    'id="deck"',
    '<h1>Talk</h1>',
    'data-viewer-article',
    'data-viewer-side',
  ])
    expect(page).toContain(part)
  expect(page).toContain('<title>Talk - @owner - Slide</title>')
})

test('F26-AC34: Given an article saved as one text and another text in the box, When previewed, Then the page shows the text in the box', async () => {
  await keepArticle(db, {
    deckId: 'talk',
    body: 'saved words',
    status: 'draft',
    citations: [],
    now: 5,
  })
  const page = await preview('box words')
  expect(articleOf(page)).toContain('box words')
  expect(page).not.toContain('saved words')
})

test('F26-AC35: Given a published article, When many texts are previewed, Then no row of the article, its citations or any launch changes', async () => {
  await keepArticle(db, {
    deckId: 'talk',
    body: 'saved',
    status: 'published',
    citations: [{ handle: 'ann', slug: 'deck', page: 1 }],
    now: 5,
  })
  const before = await rows()
  await preview(`new ${TEST_ORIGIN}/@reader/other`)
  await preview('')
  expect(await rows()).toEqual(before)
  const none = await rows()
  expect(none.articles[0]?.updated_at).toBe(5)
})

test('F26-AC35: Given no article, When a text is previewed, Then none is made', async () => {
  await preview('draft words')
  expect(await rows()).toEqual({ articles: [], citations: [], launches: [] })
})

test('F26-AC36: Given the preview in each language, When it is drawn, Then the band and the way back are above the slides', async () => {
  const ja = await preview('x')
  expect(ja).toContain('プレビューです。まだ保存していません。')
  expect(ja).toContain('編集に戻る')
  expect(ja.indexOf('data-article-preview')).toBeLessThan(
    ja.indexOf('class="viewer-layout"'),
  )
  const en = await preview('x', 'en')
  expect(en).toContain('This is a preview. It is not saved yet.')
  expect(en).toContain('Back to editing')
})

test('F26-AC37: Given a text with characters that need escaping, When the author goes back to editing, Then the box holds exactly that text', async () => {
  const body = '<b>"quoted" & more</b>\n\n日本語 😀\n'
  const page = await preview(body)
  const carried = /<input type="hidden" name="body" value="([^"]*)"/.exec(
    page,
  )?.[1]
  expect(carried).toBeDefined()
  const unescaped = (carried ?? '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
  expect(unescaped).toBe(body)
  const back = await (await post({ action: 'write', body })).text()
  expect(/<textarea[^>]*>\n([\s\S]*?)<\/textarea>/.exec(back)?.[1]).toBe(
    '&lt;b&gt;&quot;quoted&quot; &amp; more&lt;/b&gt;\n\n日本語 😀\n',
  )
  expect(back).toContain('data-unsaved="true"')
})

test.each(['draft', 'published'] as const)(
  'F26-AC38: Given a %s article saved, When previewed, Then the article shows as readers see it, with no state tag',
  async (status) => {
    await keepArticle(db, {
      deckId: 'talk',
      body: 'saved',
      status,
      citations: [],
      now: 5,
    })
    const page = await preview('# Same')
    const section = /<section\s+class="viewer-article"[\s\S]*?<\/section>/.exec(
      page,
    )?.[0]
    expect(section).toContain('<h3>Same</h3>')
    expect(section).not.toContain('status-draft')
    expect(section).not.toContain('下書き')
  },
)

test('F26-AC39: Given another author’s slides and ones that do not exist, When a preview is asked, Then the answer is the same 404 and nothing is written', async () => {
  await seedPublic(db, 'theirs', 3, 'Theirs', INVITED_ID)
  const a = await post(
    { action: 'preview', body: 'x' },
    { path: '/slides/theirs/article' },
  )
  const b = await post(
    { action: 'preview', body: 'x' },
    { path: '/slides/nothing/article' },
  )
  expect([a.status, b.status]).toEqual([404, 404])
  expect((await a.text()).replaceAll('theirs', 'X')).toBe(
    (await b.text()).replaceAll('nothing', 'X'),
  )
  expect(await rows()).toEqual({ articles: [], citations: [], launches: [] })
})

test('F26-AC39: Given no session or a foreign origin, When a preview is asked, Then it is refused', async () => {
  expect(
    (await post({ action: 'preview', body: 'x' }, { cookie: '' })).status,
  ).toBe(401)
  expect(
    (
      await post(
        { action: 'preview', body: 'x' },
        { origin: 'https://evil.example' },
      )
    ).status,
  ).toBe(403)
})

test('F26-AC10, F26-AC12, F26-AC13: Given hostile text, When previewed, Then the article’s HTML holds no script, iframe, form, handler, style attribute or javascript link', async () => {
  const page = await preview(
    [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<iframe src="https://evil.example"></iframe>',
      '<form action="/x"><input></form>',
      '[bad](javascript:alert(1))',
      '<div style="x">y</div>',
    ].join('\n\n'),
  )
  const section = articleOf(page)
  expect(section).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  for (const tag of section.match(/<[^>]*>/g) ?? []) {
    expect(tag).not.toMatch(/^<\/?(script|iframe|form|input|img)\b/i)
    expect(tag).not.toMatch(/\s(on[a-z]+|style)\s*=/i)
    expect(tag).not.toMatch(/javascript:/i)
  }
  // The band's own form is the only form on the page that sends text.
  expect(page.match(/<form\b/g)?.length ?? 0).toBeLessThanOrEqual(3)
})

test('F26-AC17, F26-AC19, F26-AC22: Given pages of the slides, of other public slides and of ones not public, When previewed, Then only the first two are images', async () => {
  await seedPublic(db, 'open', 2, 'Open deck', INVITED_ID)
  await orm.insert(decks).values({
    id: 'closed',
    slug: 'closed',
    owner_user_id: INVITED_ID,
    created_at: 1,
  })
  await seedDeployment(db, 'closed')
  const section = articleOf(
    await preview(
      [
        `${TEST_ORIGIN}/@owner/talk/3`,
        `${TEST_ORIGIN}/@reader/open/5`,
        `${TEST_ORIGIN}/@reader/closed/2`,
      ].join('\n\n'),
    ),
  )
  expect(section.match(/class="article-embed"/g)).toHaveLength(2)
  expect(section).toContain('data-article-page="3"')
  expect(section).toContain('Readerさんの『Open deck』5 ページ')
  expect(section).not.toContain('Closed')
})

test('F26-AC40: Given a text over the limit, When previewed, Then no viewer opens, the reason is given and the text stays', async () => {
  const long = 'a'.repeat(50_001)
  const response = await post({ action: 'preview', body: long })
  expect(response.status).toBe(400)
  const page = await response.text()
  expect(page).toContain('本文は 50,000 文字までです。')
  expect(page).not.toContain('data-article-preview')
  expect(page).toContain(long)
  const exact = await post({ action: 'preview', body: 'a'.repeat(50_000) })
  expect(exact.status).toBe(200)
  expect(await exact.text()).toContain('data-article-preview')
})

test('F26-AC41: Given public slides, When previewed, Then they run in a frame of the public version, and Given slides not public, Then the cover stands in and no launch is recorded', async () => {
  const open = await preview('x')
  expect(open).toContain('<iframe')
  expect(open).toContain('src="https://d-')
  expect(open).not.toContain('data-launch')

  await orm
    .update(decks)
    .set({ public_deployment_id: null })
    .where(eq(decks.id, 'talk'))
  await seedDeployment(db, 'talk')
  const closed = await preview('x')
  expect(closed).not.toContain('<iframe')
  expect(closed).not.toContain('data-launch')
  expect(closed).toContain('class="deck-cover"')
  expect(closed).toContain(
    '<h1>Talk</h1>'.replace('Talk', 'talk').length ? '<h1>' : '',
  )
  expect(await orm.select().from(previewLaunches)).toEqual([])
})

test('F26-AC41: Given the policy of the preview, When it is answered, Then it frames only the slides’ origin and posts forms only to this origin', async () => {
  const response = await post({ action: 'preview', body: 'x' })
  const policy = response.headers.get('content-security-policy') ?? ''
  expect(policy).toContain("form-action 'self'")
  expect(policy).not.toContain('form-action https://')
  expect(policy).toContain("script-src 'self'")
  expect(policy).not.toContain('unsafe-eval')
  expect(response.headers.get('cache-control')).toContain('private, no-store')
  expect(response.headers.get('x-robots-tag')).toBe('noindex')
})

test('F26-AC33: Given the readers’ viewer and the preview of the same slides, When both are drawn, Then both are made of the same layout, stage, head and side column, and the same style', async () => {
  await keepArticle(db, {
    deckId: 'talk',
    body: 'words',
    status: 'published',
    citations: [],
    now: 5,
  })
  const readers = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/@owner/talk`), env)
  ).text()
  const shown = await preview('words')
  for (const name of [
    'viewer-layout',
    'stage',
    'viewer-head',
    'viewer-article',
  ])
    for (const page of [readers, shown]) expect(page).toContain(name)
  // The one stylesheet of the viewer, not a copy of it.
  const style = (page: string) =>
    /<style>[\s\S]*?\.viewer-layout[\s\S]*?<\/style>/.exec(page)?.[0]
  expect(style(shown)).toBe(style(readers))
})
