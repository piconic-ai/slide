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

/** The revision the page of this deck would load, as the form carries it. */
const rev = async (deck = 'talk') =>
  String((await stored(deck))?.revision ?? '')

/** Sends a form of the editing page; the revision defaults to the stored one. */
const post = async (
  fields: Record<string, string>,
  init: {
    path?: string
    cookie?: string
    origin?: string
    lang?: string
    deck?: string
  } = {},
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
      body: new URLSearchParams({
        revision: await rev(init.deck),
        ...fields,
      }).toString(),
    }),
    env,
  )

/** What the page's script does as the author types. */
const autosave = (body: string, init: Parameters<typeof post>[1] = {}) =>
  post(
    { body },
    { ...init, path: `/slides/${init.deck ?? 'talk'}/article/autosave` },
  )

/** The slide's page publishes what is kept: the text is kept first, as it is by the box. */
const publish = async (body: string, init: Parameters<typeof post>[1] = {}) => {
  await autosave(body, init)
  return post(
    { action: 'publish' },
    { ...init, path: `/slides/${init.deck ?? 'talk'}/article/publication` },
  )
}
const unpublish = (init: Parameters<typeof post>[1] = {}) =>
  post(
    { action: 'unpublish' },
    { ...init, path: `/slides/${init.deck ?? 'talk'}/article/publication` },
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

test('F26-AC49, F26-AC9: Given a slide, When the page opens and text is autosaved twice, Then it is one article, a draft, with the latest text, and the page opens with it', async () => {
  const opened = await get('/slides/talk/article')
  expect(opened.status).toBe(200)
  const page = await opened.text()
  expect(page).toContain('<title>記事の編集 - slide.community</title>')
  expect(page).toContain('‹ 『Talk』の管理')
  expect(boxOf(page)).toBe('')
  expect(page).not.toContain('class="status-chip status-draft"')

  const first = await autosave('# 発表\n\n書き起こし')
  expect(first.status).toBe(200)
  expect(await first.json()).toMatchObject({ revision: 1, pending: false })
  const made = await stored()
  expect(made).toMatchObject({
    body: '# 発表\n\n書き起こし',
    draft_body: null,
    status: 'draft',
  })
  await autosave('second')
  expect(await orm.select().from(articles)).toHaveLength(1)
  expect(await stored()).toMatchObject({ body: 'second', revision: 2 })
  expect((await stored())?.created_at).toBe(made?.created_at)
  const again = await (await get('/slides/talk/article')).text()
  expect(boxOf(again)).toBe('second')
  expect(again).toContain('下書き')
})

test('F26-AC49: Given the same text again, When it is autosaved, Then the answer says nothing is pending, and a CRLF text is kept with plain line ends', async () => {
  await autosave('\n\nfirst\r\nsecond')
  expect((await stored())?.body).toBe('\n\nfirst\nsecond')
  expect(boxOf(await (await get('/slides/talk/article')).text())).toBe(
    '\n\nfirst\nsecond',
  )
})

test('F26-AC59: Given the limit, When 50,000 characters and 50,001 characters are autosaved, Then the first is kept and the second is refused with a reason', async () => {
  const exactly = 'a'.repeat(50_000)
  expect((await autosave(exactly)).status).toBe(200)
  expect((await stored())?.body).toHaveLength(50_000)
  const refused = await autosave('b'.repeat(50_001))
  expect(refused.status).toBe(400)
  expect(await refused.json()).toEqual({ error: 'too_long' })
  expect((await stored())?.body).toBe(exactly)
  expect((await autosave('😀'.repeat(50_000))).status).toBe(200)
})

test('F26-AC59: Given a published article, When a text over the limit is sent with the update button, Then it is refused with the reason, in each language, and the text stays in the box', async () => {
  await publish('kept')
  const long = 'b'.repeat(50_001)
  const ja = await post({ action: 'update', body: long })
  expect(ja.status).toBe(400)
  const page = await ja.text()
  expect(page).toContain('本文は 50,000 文字までです。')
  expect(boxOf(page)).toBe(long)
  const en = await (
    await post({ action: 'update', body: long }, { lang: 'en' })
  ).text()
  expect(en).toContain('The text can have at most 50,000 characters.')
  expect((await stored()).body).toBe('kept')
})
test('F26-AC78: Given an empty text kept as a draft, When the slide’s page publishes it, Then it is refused as empty and nothing changes', async () => {
  expect((await autosave('  \n')).status).toBe(200)
  const before = await stored()
  const refused = await post(
    { action: 'publish' },
    { path: '/slides/talk/article/publication' },
  )
  expect(refused.status).toBe(400)
  expect(await refused.text()).toContain('本文が空です')
  expect(await stored()).toEqual(before)
  expect(before).toMatchObject({ status: 'draft' })
})
test('F26-AC78, F26-AC95, F26-AC53: Given a draft, When it is published and then edited by autosave, Then the published text stays and the edit is held apart, and the page opens with the edit', async () => {
  await autosave('first')
  const published = await publish('second')
  expect(published.headers.get('Location')).toBe('/slides/talk')
  expect(await stored()).toMatchObject({
    body: 'second',
    draft_body: null,
    status: 'published',
  })
  const edited = await autosave('third')
  expect(await edited.json()).toMatchObject({ pending: true })
  expect(await stored()).toMatchObject({
    body: 'second',
    draft_body: 'third',
    status: 'published',
  })
  const page = await (await get('/slides/talk/article')).text()
  expect(boxOf(page)).toBe('third')
  expect(page).toContain('公開中')
  expect(page).toContain('未反映の変更あり')
  expect(page).not.toContain('data-pending-chip hidden')
  // Typing the published text back leaves nothing pending.
  expect(await (await autosave('second')).json()).toMatchObject({
    pending: false,
  })
  expect((await stored())?.draft_body).toBeNull()
})

test('F26-AC81: Given a published article with an edit and links, When the publication is updated, Then the edit is the published text, its links are the citations, and nothing is pending', async () => {
  await publish(`${TEST_ORIGIN}/@ann/old`)
  expect(await cited()).toEqual(['ann/old/0'])
  await autosave(`${TEST_ORIGIN}/@bob/new/2`)
  expect(await cited()).toEqual(['ann/old/0'])
  const updated = await post({
    action: 'update',
    body: `${TEST_ORIGIN}/@bob/new/2`,
  })
  expect(updated.headers.get('Location')).toBe(
    '/slides/talk/article?result=updated',
  )
  expect(await stored()).toMatchObject({
    body: `${TEST_ORIGIN}/@bob/new/2`,
    draft_body: null,
    status: 'published',
  })
  expect(await cited()).toEqual(['bob/new/2'])
})

test('F26-AC82: Given a published article with an edit, When the changes are discarded, Then the published text is in the box and what readers see did not change', async () => {
  await publish('published text')
  await autosave('an edit')
  const discarded = await post({ action: 'discard', body: 'an edit' })
  expect(discarded.headers.get('Location')).toBe(
    '/slides/talk/article?result=discarded',
  )
  expect(await stored()).toMatchObject({
    body: 'published text',
    draft_body: null,
    status: 'published',
  })
  expect(boxOf(await (await get('/slides/talk/article')).text())).toBe(
    'published text',
  )
})

test('F26-AC85: Given a published article with an edit and citations, When it is unpublished, Then the edit is the draft text, it is a draft, and the citations are gone', async () => {
  await publish(`${TEST_ORIGIN}/@ann/deck`)
  await autosave('the edit')
  await unpublish()
  expect(await stored()).toMatchObject({
    body: 'the edit',
    draft_body: null,
    status: 'draft',
  })
  expect(await cited()).toEqual([])
  // Without an edit, the published text becomes the draft.
  await publish('again')
  await unpublish()
  expect(await stored()).toMatchObject({ body: 'again', status: 'draft' })
})

test('F26-AC83: Given a page loaded at an old revision, When autosave and each button are sent from it, Then every one is refused and nothing changes', async () => {
  await autosave('one')
  const old = await rev()
  await autosave('two')
  const before = await stored()
  const stale = await autosave('from the old tab', {})
  // The helper takes the latest revision; send the old one by hand.
  expect(stale.status).toBe(200)
  const staleOnes = await Promise.all(
    ['publish', 'update', 'discard', 'unpublish'].map((action) =>
      post(
        { action, body: 'x', revision: old },
        action === 'publish' || action === 'unpublish'
          ? { path: '/slides/talk/article/publication' }
          : {},
      ),
    ),
  )
  for (const response of staleOnes) {
    expect(response.status).toBe(409)
    expect(await response.text()).toContain('別のタブで更新されています')
  }
  const refused = await post(
    { body: 'late' },
    { path: '/slides/talk/article/autosave' },
  )
  expect(refused.status).toBe(200)
  const direct = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk/article/autosave`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ body: 'old', revision: old }).toString(),
    }),
    env,
  )
  expect(direct.status).toBe(409)
  expect(await direct.json()).toEqual({ error: 'conflict' })
  expect((await stored())?.body).not.toBe('old')
  expect(before?.revision).toBeLessThan((await stored())!.revision)
})

test('F26-AC83: Given a screen that loaded no article and another tab that made one, When the first autosaves, Then it is a conflict', async () => {
  await autosave('made elsewhere')
  const first = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/talk/article/autosave`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ body: 'mine', revision: '' }).toString(),
    }),
    env,
  )
  expect(first.status).toBe(409)
  expect((await stored())?.body).toBe('made elsewhere')
})

test('F26-AC83: Given an untrusted revision, When it is not a number, Then autosave refuses it', async () => {
  for (const revision of ['abc', '-1', '1.5', '99999999999'])
    expect(
      (
        await post(
          { body: 'x', revision },
          { path: '/slides/talk/article/autosave' },
        )
      ).status,
    ).toBe(400)
})

test('F24-AC19, F24-AC20, F24-AC21: Given links to other slides and to the article’s own, When the article is published, edited, unpublished and published again, Then its citations are kept only while it is published and only from the published text, never its own slides', async () => {
  const body = [
    `Look at [Ann](${TEST_ORIGIN}/@ann/deck/3) and ${TEST_ORIGIN}/@ann/deck/3 again.`,
    `${TEST_ORIGIN}/@bob/talk/2`,
    `My own ${TEST_ORIGIN}/@owner/talk/5 and ${TEST_ORIGIN}/@owner/talk`,
  ].join('\n\n')
  await autosave(body)
  expect(await cited()).toEqual([])
  await publish(body)
  expect(await cited()).toEqual(['ann/deck/3', 'bob/talk/2'])
  await autosave(`${TEST_ORIGIN}/@cy/one`)
  expect(await cited()).toEqual(['ann/deck/3', 'bob/talk/2'])
  await unpublish()
  expect(await cited()).toEqual([])
  await autosave(`${TEST_ORIGIN}/@dee/two/9`)
  expect(await cited()).toEqual([])
  await publish(body)
  expect(await cited()).toEqual(['ann/deck/3', 'bob/talk/2'])
})

test('F26-AC27: Given another author’s slides and slides that do not exist, When the author opens, autosaves, renders, publishes or unpublishes there, Then each answer is the same 404 and nothing is written', async () => {
  await signIn(env, 'reader', { id: INVITED_ID })
  await seedPublic(db, 'theirs', 1, 'Theirs', INVITED_ID)
  const answers = async (deck: string) => {
    const out = [(await get(`/slides/${deck}/article`)).status]
    for (const action of ['update', 'discard', 'preview'])
      out.push(
        (await post({ action, body: 'x' }, { path: `/slides/${deck}/article` }))
          .status,
      )
    for (const path of ['autosave', 'render', 'publication'])
      out.push(
        (await post({ body: 'x' }, { path: `/slides/${deck}/article/${path}` }))
          .status,
      )
    return out
  }
  expect(await answers('theirs')).toEqual([404, 404, 404, 404, 404, 404, 404])
  expect(await answers('nothing')).toEqual([404, 404, 404, 404, 404, 404, 404])
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
  await autosave('mine')
  const other = await signIn(env, 'reader', { id: INVITED_ID })
  const response = await post(
    { action: 'publish', revision: '1' },
    { cookie: other, path: '/slides/talk/article/publication' },
  )
  expect(response.status).toBe(404)
  expect(await stored()).toMatchObject({ body: 'mine', status: 'draft' })
})

test('F26-AC27: Given no session or a foreign origin, When the form is sent, Then nothing is written', async () => {
  const signedOut = await autosave('x', { cookie: '' })
  expect(signedOut.status).toBe(401)
  const foreign = await autosave('x', { origin: 'https://evil.example' })
  expect(foreign.status).toBe(403)
  const page = await get('/slides/talk/article', { cookie: '' })
  expect(page.status).toBe(401)
  expect(await orm.select().from(articles)).toEqual([])
})

test('F26-AC28: Given an article and its citations, When the slides are deleted, Then the article and its citations are gone', async () => {
  await publish(`${TEST_ORIGIN}/@ann/deck/3`)
  expect(await cited()).toHaveLength(1)
  await markDeckDeleted(db, { deckId: 'talk', ownerUserId: OWNER_ID, now: 10 })
  expect(await orm.select().from(articles)).toEqual([])
  expect(await orm.select().from(articleCitations)).toEqual([])
})

test('F26-AC28: Given the slides are deleted, When the author opens or posts to the editing page, Then it is a 404 and nothing is written', async () => {
  await markDeckDeleted(db, { deckId: 'talk', ownerUserId: OWNER_ID, now: 10 })
  expect((await get('/slides/talk/article')).status).toBe(404)
  expect((await autosave('x')).status).toBe(404)
  expect(await orm.select().from(articles)).toEqual([])
})

test('F26-AC29: Given articles under two slides of the author and one of another, When the author leaves, Then their articles are gone and the other’s stays', async () => {
  await seedPublic(db, 'second', 2, 'Second')
  await publish(`${TEST_ORIGIN}/@ann/a`)
  await autosave('two', { deck: 'second' })
  const reader = await signIn(env, 'reader', { id: INVITED_ID })
  await seedPublic(db, 'theirs', 3, 'Theirs', INVITED_ID)
  await autosave('theirs', { deck: 'theirs', cookie: reader })
  expect(await orm.select().from(articles)).toHaveLength(3)
  await markAccountDeleted(db, { ownerUserId: OWNER_ID, now: 10 })
  expect((await orm.select().from(articles)).map((row) => row.deck_id)).toEqual(
    ['theirs'],
  )
  expect(await orm.select().from(articleCitations)).toEqual([])
})

test('F26-AC90: Given slides with no article, a draft and a published article, When the slide’s page opens, Then the frame shows what there is: the way to write, or the state, the day saved and the length', async () => {
  const none = await (await get('/slides/talk')).text()
  expect(none).toContain('data-deck-frame="article"')
  expect(none).toContain('記事を書く')
  expect(none).not.toContain('最後に保存した日')

  await autosave('漢字😀')
  const draft = await (await get('/slides/talk')).text()
  expect(draft).toContain('記事を編集する')
  expect(draft).toContain('下書き')
  expect(draft).toContain('最後に保存した日')
  expect(draft).toContain('3 / 50,000 文字')
  expect(draft).toContain('href="/slides/talk/article"')

  await publish('漢字😀')
  const published = await (await get('/slides/talk')).text()
  expect(published).toContain('status-public')
  expect(published).toContain('公開中')
})

test('F26-AC90: Given English, When the slide’s page opens, Then the article frame is in English', async () => {
  await autosave('x')
  const page = await (await get('/slides/talk', { lang: 'en' })).text()
  expect(page).toContain('Edit the article')
  expect(page).toContain('Last saved:')
  expect(page).toContain('1 / 50,000 characters')
})

test('F26-AC45, F26-AC74: Given the editing page in each language, When it opens, Then no long explanation stands on it, and one guide link goes to the help from the row above the box', async () => {
  for (const [lang, link] of [
    ['ja', 'Markdown ガイド'],
    ['en', 'Markdown guide'],
  ] as const) {
    const page = await (await get('/slides/talk/article', { lang })).text()
    for (const gone of [
      'ページ番号つきの共有 URL',
      'HTML と script は使えません',
      'AI エージェントは下書きまで',
      'A share URL with a page number',
      'HTML and scripts are not allowed',
      'AI agents can only leave a draft',
    ])
      expect(page).not.toContain(gone)
    expect(page.match(/href="\/help#article"/g)).toHaveLength(1)
    expect(page).toContain(`>${link}</a`)
  }
})

test('F26-AC73, F26-AC75: Given the editing page in each language, When it is drawn, Then the h1 is hidden text of the document, no label stands by the box, and the box has a name and a placeholder', async () => {
  for (const [lang, h1, name, hint] of [
    [
      'ja',
      '記事の編集',
      '記事の本文(Markdown)',
      '発表で話したことを書きます。Markdown が使えます。',
    ],
    [
      'en',
      'Edit the article',
      'Article text (Markdown)',
      'Write what you said in the talk. Markdown works.',
    ],
  ] as const) {
    const page = await (await get('/slides/talk/article', { lang })).text()
    expect(page).toContain(`<h1 class="visually-hidden">${h1}</h1>`)
    expect(page).not.toMatch(/<label[^>]*for="article-body"/)
    expect(page).toContain(`aria-label="${name}"`)
    expect(page).toContain(`placeholder="${hint}"`)
    expect(page).not.toContain('article-edit-head')
  }
})

test('F26-AC43, F26-AC92: Given the editing page, When it is drawn, Then it has no tab markup, the viewer button is at the top, a draft has no button under the box, and a publication has update and undo only', async () => {
  const page = await (await get('/slides/talk/article')).text()
  expect(page).not.toContain('role="tab')
  expect(page).not.toContain('tablist')
  expect(page).not.toContain('aria-selected')
  expect(page).not.toContain('article-tabs')
  expect(page).not.toContain('value="write"')
  const top = /<div class="article-top">([\s\S]*?)<\/div>/.exec(page)?.[1] ?? ''
  expect(top).toContain('form="article-form"')
  expect(top).toContain('value="preview"')
  expect(top).toContain('ビューアーで見る')
  expect(page).not.toContain('class="article-actions"')
  for (const gone of [
    '公開する',
    '公開を取り下げる',
    '公開を更新',
    '変更を破棄',
    'プレビュー',
  ])
    expect(page).not.toContain(`>${gone}<`)
  await publish('x')
  const published = await (await get('/slides/talk/article')).text()
  const after =
    /<div class="article-actions">([\s\S]*?)<\/div>/.exec(published)?.[1] ?? ''
  expect(
    [...after.matchAll(/value="(\w+)"/g)].map((match) => match[1]),
  ).toEqual(['update', 'discard'])
  expect(after).toContain('公開記事を更新')
  expect(after).toContain('変更を取り消す')
  expect(published).not.toContain('記事の公開を止める')
  const en = await (await get('/slides/talk/article', { lang: 'en' })).text()
  expect(en).toContain('View in viewer')
  expect(en).toContain('Update published article')
  expect(en).toContain('Undo changes')
})

test('F26-AC51: Given the editing page, When it opens and when it opens again with changed text, Then the form says whether the box holds text the server lacks, clean the first time and not the second', async () => {
  await autosave('saved')
  const clean = await (await get('/slides/talk/article')).text()
  expect(clean).toContain('data-unsaved="false"')
  const back = await (await post({ action: 'write', body: 'changed' })).text()
  expect(back).toContain('data-unsaved="true"')
  const same = await (await post({ action: 'write', body: 'saved' })).text()
  expect(same).toContain('data-unsaved="false"')
})

test('F26-AC5: Given the author’s profile with a display name, When the editing page opens, Then the page is the author’s own and shows no email address', async () => {
  await orm.insert(profiles).values({ user_id: OWNER_ID, name: 'Owner' })
  const page = await (await get('/slides/talk/article')).text()
  expect(page).not.toContain('@mail.example')
})

test('F24-AC19: Given an article with 150 different links, When it is published, Then at most 100 citations are kept, as many as a version keeps', async () => {
  const body = Array.from(
    { length: 150 },
    (_, index) => `${TEST_ORIGIN}/@ann/deck-${index}`,
  ).join('\n\n')
  expect((await publish(body)).status).toBe(303)
  expect(await orm.select().from(articleCitations)).toHaveLength(100)
  expect((await stored())?.body).toBe(body)
})

test('F26-AC16: Given a text over the limit, When the author previews it, Then it is refused as too long, not drawn, and the text stays in the box', async () => {
  const long = 'b'.repeat(50_001)
  const response = await post({ action: 'preview', body: long })
  expect(response.status).toBe(400)
  const page = await response.text()
  expect(page).toContain('本文は 50,000 文字までです。')
  expect(page).not.toContain('data-article-preview')
  expect(boxOf(page)).toBe(long)
  const written = await post({ action: 'write', body: long })
  expect(written.status).toBe(400)
})

test('F26-AC28: Given the slides are deleted just before a save lands, When the save runs, Then no article or citation row is left', async () => {
  await markDeckDeleted(db, { deckId: 'talk', ownerUserId: OWNER_ID, now: 10 })
  const { keepArticle } = await import('./store')
  await keepArticle(db, {
    deckId: 'talk',
    body: 'late',
    status: 'published',
    citations: [{ handle: 'ann', slug: 'deck', page: 1 }],
    now: 11,
  })
  expect(await orm.select().from(articles)).toEqual([])
  expect(await orm.select().from(articleCitations)).toEqual([])
})

test('F26-AC19: Given twenty pages of twenty other public slides, When the author previews, Then they are looked up by one query for all of them', async () => {
  for (let index = 0; index < 20; index++)
    await seedPublic(db, `d${index}`, 2 + index, `Deck ${index}`, INVITED_ID)
  await signIn(env, 'reader', { id: INVITED_ID })
  const { resolveEmbeds } = await import('./embed-store')
  const pages = Array.from({ length: 20 }, (_, index) => ({
    handle: 'reader',
    slug: `d${index}`,
    page: 2,
  }))
  const prepared: string[] = []
  const counting = new Proxy(db, {
    get(target, key) {
      const value = Reflect.get(target, key) as unknown
      if (key !== 'prepare' || typeof value !== 'function') return value
      return (query: string) => {
        prepared.push(query)
        return value.call(target, query)
      }
    },
  })
  const found = await resolveEmbeds(counting, {
    pages,
    own: { handle: 'owner', slug: 'talk', version: null },
    contentBase: new URL('https://content.example'),
  })
  expect(found.size).toBe(20)
  expect(prepared.filter((query) => /select/i.test(query))).toHaveLength(1)
})
