import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { articleCitations, articles, decks, profiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { markAccountDeleted, markDeckDeleted } from '../decks/deletion-store'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let cookie = ''
let talk = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  cookie = await signIn(env)
  talk = await seedPublic(db, 'talk', 1, 'Talk')
})
afterAll(() => platform.dispose())

const get = (path: string, init: { cookie?: string; lang?: string } = {}) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: {
        Cookie: init.cookie ?? cookie,
        'Accept-Language': init.lang ?? 'ja',
      },
    }),
    env,
  )

const post = (
  fields: Record<string, string>,
  init: { path?: string; cookie?: string; origin?: string; lang?: string } = {},
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${init.path ?? '/slides/talk/article'}`, {
      method: 'POST',
      headers: {
        Cookie: init.cookie ?? cookie,
        Origin: init.origin ?? TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept-Language': init.lang ?? 'ja',
      },
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )

const stored = async (deck = 'talk') =>
  (await orm.select().from(articles).where(eq(articles.deck_id, deck)))[0]
const cited = async () =>
  (await orm.select().from(articleCitations))
    .map((row) => `${row.target_handle}/${row.target_slug}/${row.target_page}`)
    .sort()

/** The text in the box of an editing page, as the browser would read it. */
const boxOf = (page: string) =>
  /<textarea[^>]*>\n?([\s\S]*?)<\/textarea>/.exec(page)?.[1] ?? null

/** The part of the page that holds the preview, apart from the site's own scripts. */
const previewOf = (page: string) =>
  /<div class="article-text article-preview"[^>]*>([\s\S]*?)<\/div>\s*(?:<p class="notice|<div class="article-actions)/.exec(
    page,
  )?.[1] ?? null

test('F26-AC1: Given a slide, When the author opens the editing page and saves a draft, Then the text is kept and the page shows it as a draft', async () => {
  const opened = await get('/slides/talk/article')
  expect(opened.status).toBe(200)
  const page = await opened.text()
  expect(page).toContain('<title>記事の編集 - Slide</title>')
  expect(page).toContain('‹ 『Talk』の管理')
  expect(boxOf(page)).toBe('')
  expect(page).not.toContain('class="status-chip')

  const saved = await post({ action: 'save', body: '# 発表\n\n書き起こし' })
  expect(saved.status).toBe(303)
  expect(saved.headers.get('Location')).toBe(
    '/slides/talk/article?result=saved',
  )
  expect(await stored()).toMatchObject({
    body: '# 発表\n\n書き起こし',
    status: 'draft',
  })

  const again = await (await get('/slides/talk/article?result=saved')).text()
  expect(boxOf(again)).toBe('# 発表\n\n書き起こし')
  expect(again).toContain('下書き')
  expect(again).toContain('保存しました。')
  expect(again).toContain('下書きを保存')
  expect(again).toContain('公開する')
})

test('F26-AC1: Given text that starts with blank lines and has CRLF, When it is saved and the page opens again, Then the box holds the same text with plain line ends', async () => {
  await post({ action: 'save', body: '\n\nfirst\r\nsecond' })
  expect((await stored())?.body).toBe('\n\nfirst\nsecond')
  const page = await (await get('/slides/talk/article')).text()
  expect(boxOf(page)).toBe('\n\nfirst\nsecond')
})

test('F26-AC9: Given an article, When the author saves again and opens the page again, Then there is still one article, the same one, with the new text', async () => {
  await post({ action: 'save', body: 'one' })
  const first = await stored()
  await post({ action: 'save', body: 'two' })
  expect(await orm.select().from(articles)).toHaveLength(1)
  expect((await stored())?.body).toBe('two')
  expect((await stored())?.created_at).toBe(first?.created_at)
  expect(boxOf(await (await get('/slides/talk/article')).text())).toBe('two')
})

test('F26-AC16: Given the limit, When 50,000 characters and 50,001 characters are sent, Then the first is kept and the second is refused with a reason and the text still in the box', async () => {
  const exactly = 'a'.repeat(50_000)
  expect((await post({ action: 'save', body: exactly })).status).toBe(303)
  expect((await stored())?.body).toHaveLength(50_000)

  const long = 'b'.repeat(50_001)
  const refused = await post({ action: 'save', body: long })
  expect(refused.status).toBe(400)
  const page = await refused.text()
  expect(page).toContain('本文は 50,000 文字までです。保存していません。')
  expect(boxOf(page)).toBe(long)
  expect((await stored())?.body).toBe(exactly)
  expect(page).toContain('data-dirty="true"')
})

test('F26-AC16: Given emoji, When 50,000 of them are sent, Then they are kept, as the limit counts characters', async () => {
  const emoji = '😀'.repeat(50_000)
  expect((await post({ action: 'save', body: emoji })).status).toBe(303)
  expect((await stored())?.body).toBe(emoji)
})

test('F26-AC16: Given English, When a text too long is sent, Then the reason is in English', async () => {
  const page = await (
    await post({ action: 'save', body: 'b'.repeat(50_001) }, { lang: 'en' })
  ).text()
  expect(page).toContain('The text can have at most 50,000 characters.')
})

test('F26-AC4, F26-AC6, F26-AC7: Given a draft, When it is published, edited and unpublished, Then its state and text follow, and a save keeps it published', async () => {
  await post({ action: 'save', body: 'first' })
  expect(
    (await post({ action: 'publish', body: 'second' })).headers.get('Location'),
  ).toBe('/slides/talk/article?result=published')
  expect(await stored()).toMatchObject({ body: 'second', status: 'published' })

  await post({ action: 'save', body: 'third' })
  expect(await stored()).toMatchObject({ body: 'third', status: 'published' })
  const published = await (await get('/slides/talk/article')).text()
  expect(published).toContain('公開中')
  expect(published).toContain('公開を取り下げる')
  expect(published).toContain('保存する')
  expect(published).not.toContain('下書きを保存')

  await post({ action: 'unpublish' })
  expect(await stored()).toMatchObject({ body: 'third', status: 'draft' })
})

test('F26-AC4: Given an empty text, When it is sent to publish, Then it is refused, but it can be saved as a draft', async () => {
  const refused = await post({ action: 'publish', body: '  \n' })
  expect(refused.status).toBe(400)
  expect(await refused.text()).toContain('本文が空です')
  expect(await stored()).toBeUndefined()
  expect((await post({ action: 'save', body: '' })).status).toBe(303)
  expect(await stored()).toMatchObject({ body: '', status: 'draft' })
})

test('F24-AC19, F24-AC20, F24-AC21: Given links to other slides and to the article’s own, When the article is published, saved, unpublished and published again, Then its citations are kept only while it is published, and never include its own slides', async () => {
  const body = [
    `Look at [Ann](${TEST_ORIGIN}/@ann/deck/3) and ${TEST_ORIGIN}/@ann/deck/3 again.`,
    `${TEST_ORIGIN}/@bob/talk/2`,
    `My own ${TEST_ORIGIN}/@owner/talk/5 and ${TEST_ORIGIN}/@owner/talk`,
  ].join('\n\n')
  await post({ action: 'save', body })
  expect(await cited()).toEqual([])

  await post({ action: 'publish', body })
  expect(await cited()).toEqual(['ann/deck/3', 'bob/talk/2'])

  await post({ action: 'save', body: `${TEST_ORIGIN}/@cy/one` })
  expect(await cited()).toEqual(['cy/one/0'])

  await post({ action: 'unpublish' })
  expect(await cited()).toEqual([])
  await post({ action: 'save', body: `${TEST_ORIGIN}/@dee/two/9` })
  expect(await cited()).toEqual([])

  await post({ action: 'publish', body })
  expect(await cited()).toEqual(['ann/deck/3', 'bob/talk/2'])
})

test('F26-AC27: Given another author’s slides and slides that do not exist, When the author opens, saves, publishes or unpublishes there, Then each answer is the same 404 and nothing is written', async () => {
  await signIn(env, 'reader', { id: INVITED_ID })
  await seedPublic(db, 'theirs', 1, 'Theirs', INVITED_ID)
  const answers = async (deck: string) => {
    const out = [(await get(`/slides/${deck}/article`)).status]
    for (const action of ['save', 'publish', 'unpublish', 'preview'])
      out.push(
        (await post({ action, body: 'x' }, { path: `/slides/${deck}/article` }))
          .status,
      )
    return out
  }
  expect(await answers('theirs')).toEqual([404, 404, 404, 404, 404])
  expect(await answers('nothing')).toEqual([404, 404, 404, 404, 404])
  const foreign = await get('/slides/theirs/article')
  const unknown = await get('/slides/nothing/article')
  // The pages differ only where the footer's language link names the address.
  const [a, b] = [
    (await foreign.text()).replaceAll('theirs', 'X'),
    (await unknown.text()).replaceAll('nothing', 'X'),
  ]
  expect(a).toBe(b)
  expect(await orm.select().from(articles)).toEqual([])
})

test('F26-AC27: Given an article of the author, When another signed-in author posts to the same path, Then it is a 404 and the article is unchanged', async () => {
  await post({ action: 'save', body: 'mine' })
  const other = await signIn(env, 'reader', { id: INVITED_ID })
  const response = await post(
    { action: 'publish', body: 'taken' },
    { cookie: other },
  )
  expect(response.status).toBe(404)
  expect(await stored()).toMatchObject({ body: 'mine', status: 'draft' })
})

test('F26-AC27: Given no session or a foreign origin, When the form is sent, Then nothing is written', async () => {
  const signedOut = await post({ action: 'save', body: 'x' }, { cookie: '' })
  expect(signedOut.status).toBe(401)
  const foreign = await post(
    { action: 'save', body: 'x' },
    { origin: 'https://evil.example' },
  )
  expect(foreign.status).toBe(403)
  const page = await get('/slides/talk/article', { cookie: '' })
  expect(page.status).toBe(401)
  expect(await orm.select().from(articles)).toEqual([])
})

test('F26-AC28: Given an article and its citations, When the slides are deleted, Then the article and its citations are gone', async () => {
  await post({ action: 'publish', body: `${TEST_ORIGIN}/@ann/deck/3` })
  expect(await cited()).toHaveLength(1)
  await markDeckDeleted(db, { deckId: 'talk', ownerUserId: OWNER_ID, now: 10 })
  expect(await orm.select().from(articles)).toEqual([])
  expect(await orm.select().from(articleCitations)).toEqual([])
})

test('F26-AC28: Given the slides are deleted, When the author opens or posts to the editing page, Then it is a 404 and nothing is written', async () => {
  await markDeckDeleted(db, { deckId: 'talk', ownerUserId: OWNER_ID, now: 10 })
  expect((await get('/slides/talk/article')).status).toBe(404)
  expect((await post({ action: 'save', body: 'x' })).status).toBe(404)
  expect(await orm.select().from(articles)).toEqual([])
})

test('F26-AC29: Given articles under two slides of the author and one of another, When the author leaves, Then their articles are gone and the other’s stays', async () => {
  await seedPublic(db, 'second', 2, 'Second')
  await post({ action: 'publish', body: `${TEST_ORIGIN}/@ann/a` })
  await post(
    { action: 'save', body: 'two' },
    { path: '/slides/second/article' },
  )
  const reader = await signIn(env, 'reader', { id: INVITED_ID })
  await seedPublic(db, 'theirs', 3, 'Theirs', INVITED_ID)
  await post(
    { action: 'save', body: 'theirs' },
    { path: '/slides/theirs/article', cookie: reader },
  )
  expect(await orm.select().from(articles)).toHaveLength(3)
  await markAccountDeleted(db, { ownerUserId: OWNER_ID, now: 10 })
  expect((await orm.select().from(articles)).map((row) => row.deck_id)).toEqual(
    ['theirs'],
  )
  expect(await orm.select().from(articleCitations)).toEqual([])
})

test('F26-AC26: Given slides with no article, a draft and a published article, When the slide’s page opens, Then the frame shows what there is: the way to write, or the state, the day saved and the length', async () => {
  const none = await (await get('/slides/talk')).text()
  expect(none).toContain('data-deck-frame="article"')
  expect(none).toContain('記事を書く')
  expect(none).not.toContain('最後に保存した日')

  await post({ action: 'save', body: '漢字😀' })
  const draft = await (await get('/slides/talk')).text()
  expect(draft).toContain('記事を編集する')
  expect(draft).toContain('下書き')
  expect(draft).toContain('最後に保存した日')
  expect(draft).toContain('3 / 50,000 文字')
  expect(draft).toContain('href="/slides/talk/article"')

  await post({ action: 'publish', body: '漢字😀' })
  const published = await (await get('/slides/talk')).text()
  expect(published).toContain('status-public')
  expect(published).toContain('公開中')
})

test('F26-AC26: Given English, When the slide’s page opens, Then the article frame is in English', async () => {
  await post({ action: 'save', body: 'x' })
  const page = await (await get('/slides/talk', { lang: 'en' })).text()
  expect(page).toContain('Edit the article')
  expect(page).toContain('Last saved:')
  expect(page).toContain('1 / 50,000 characters')
})

test('F26-AC31: Given the editing page in each language, When it opens, Then the note on writing share URLs stands under the box', async () => {
  const ja = await (await get('/slides/talk/article')).text()
  expect(ja).toContain(
    'ページ番号つきの共有 URL を 1 行で書くと、そのページの画像が入ります。',
  )
  expect(ja).toContain('HTML と script は使えません。')
  const en = await (await get('/slides/talk/article', { lang: 'en' })).text()
  expect(en).toContain('A share URL with a page number, alone on a line')
  expect(en).toContain('HTML and scripts are not allowed.')
})

test('F26-AC30: Given the editing page, When it opens and when it opens after a preview of changed text, Then the form guards unsaved text, starting clean the first time and dirty the second', async () => {
  await post({ action: 'save', body: 'saved' })
  const clean = await (await get('/slides/talk/article')).text()
  expect(clean).toContain('data-unsaved-guard')
  expect(clean).toContain('data-dirty="false"')
  const preview = await (
    await post({ action: 'preview', body: 'changed' })
  ).text()
  expect(preview).toContain('data-dirty="true"')
  const same = await (await post({ action: 'preview', body: 'saved' })).text()
  expect(same).toContain('data-dirty="false"')
})

test('F26-AC10, F26-AC12: Given Markdown and hostile text, When the author previews it, Then the preview shows the Markdown and nothing hostile', async () => {
  const body = [
    '## 見出し',
    '- a\n- b',
    '| x | y |\n|---|---|\n| 1 | 2 |',
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[bad](javascript:alert(1))',
    '<iframe src="https://evil.example"></iframe>',
    '<form action="/x"><input></form>',
    '<p style="x">y</p>',
  ].join('\n\n')
  const page = await (await post({ action: 'preview', body })).text()
  const preview = previewOf(page)
  expect(preview).not.toBeNull()
  expect(preview).toContain('<h4>見出し</h4>')
  expect(preview).toContain('<table>')
  expect(preview).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(preview).not.toMatch(/<(script|iframe|form|img|input)\b/i)
  expect(preview).not.toMatch(/<[^>]*\s(on[a-z]+|style)\s*=/i)
  expect(preview).not.toContain('<a href="javascript')
  // Previewing saves nothing.
  expect(await orm.select().from(articles)).toEqual([])
})

test('F26-AC17, F26-AC19, F26-AC22: Given pages of the article’s own slides, of another author’s public slides and of slides that are not public, When the author previews them, Then only the first two show images, and the third shows no title', async () => {
  await signIn(env, 'reader', {
    id: INVITED_ID,
    name: 'Reader <b>',
  })
  await seedPublic(db, 'open', 2, 'Open deck', INVITED_ID)
  await orm.update(decks).set({ slug: 'open' }).where(eq(decks.id, 'open'))
  // A draft of the reader's: no public version.
  await orm.insert(decks).values({
    id: 'closed',
    slug: 'closed',
    owner_user_id: INVITED_ID,
    created_at: 1,
  })
  await seedDeployment(db, 'closed')
  const body = [
    `${TEST_ORIGIN}/@owner/talk/3`,
    `${TEST_ORIGIN}/@reader/open/5`,
    `${TEST_ORIGIN}/@reader/closed/2`,
    `${TEST_ORIGIN}/@reader/missing/2`,
  ].join('\n\n')
  const page = await (await post({ action: 'preview', body })).text()
  const preview = previewOf(page) ?? ''
  expect(preview.match(/class="article-embed"/g)).toHaveLength(2)
  expect(preview).toContain('href="/@owner/talk/3"')
  expect(preview).toContain('data-article-page="3"')
  expect(preview).toContain('href="/@reader/open/5"')
  expect(preview).toContain('Reader &lt;b&gt;さんの『Open deck』5 ページ')
  expect(preview).not.toContain('closed" ')
  expect(preview).not.toContain('Closed')
  expect(preview).toContain(
    `<a href="${TEST_ORIGIN}/@reader/closed/2" rel="noopener nofollow ugc">`,
  )
  expect(preview).toContain(
    `<a href="${TEST_ORIGIN}/@reader/missing/2" rel="noopener nofollow ugc">`,
  )
})

test('F26-AC21: Given a share URL inside a sentence, When it is previewed, Then it is a plain link', async () => {
  const page = await (
    await post({
      action: 'preview',
      body: `See ${TEST_ORIGIN}/@owner/talk/3 for it.`,
    })
  ).text()
  expect(previewOf(page)).not.toContain('article-embed')
  expect(previewOf(page)).toContain('<a href=')
})

test('F26-AC23: Given a page past the version’s last page and a known count, When the editing page is drawn, Then it names the URL and the last page', async () => {
  const { editBody } = await import('./edit-page')
  const page = String(
    editBody(
      {
        slug: 'talk',
        deckName: 'Talk',
        article: null,
        body: '',
        preview: null,
        notice: null,
        missing: [{ handle: 'owner', slug: 'talk', page: 14 }],
        pageCount: 12,
      },
      'ja',
    ),
  )
  expect(page).toContain(
    '/@owner/talk/14 のページは、いまの版にありません(12 ページまで)。',
  )
  expect(page).toContain(
    '読者には、ページの画像の代わりにふつうのリンクが出ます。',
  )
})

test('F26-AC5: Given the author’s profile with a display name, When the editing page opens, Then the page is the author’s own and shows no email address', async () => {
  await orm.insert(profiles).values({ user_id: OWNER_ID, name: 'Owner' })
  const page = await (await get('/slides/talk/article')).text()
  expect(page).not.toContain('@mail.example')
})
