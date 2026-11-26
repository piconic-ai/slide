import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { keepArticle } from '../articles/store'
import { decks, profilePictures, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { placeFiles, publish } from './test-upload'

// Each test puts slides up over HTTP; a loaded machine needs more than 5 s.
vi.setConfig({ testTimeout: 30_000 })

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const orm = drizzle(database)
const env = {
  ...testEnv(platform.env),
  UPLOAD_LIMITS: { activeSessions: 20, startsPerDay: 1000, files: 500 },
} as unknown as Env
await applyMigrations(database)
afterAll(() => platform.dispose())

let alice = ''
let bob = ''
beforeEach(async () => {
  await resetTables(database)
  alice = await signIn(env, 'alice')
  bob = await signIn(env, 'bob', { id: INVITED_ID })
}, 30_000)

const page = async (path: string, cookie = alice, lang = 'ja') => {
  const url = new URL(path, TEST_ORIGIN)
  url.searchParams.set('lang', lang)
  const response = await server.fetch(
    new Request(url, { headers: { Cookie: cookie } }),
    env,
  )
  return { status: response.status, html: await response.text() }
}
const hrefs = (html: string, within: string) =>
  [
    ...html.slice(html.indexOf(within)).matchAll(/href="([^"]+)" download/g),
  ].map((m) => m[1])

describe('1 本の管理の「ダウンロード」', () => {
  it('F35-AC1, F35-AC2: Given a published slide, When its page opens, Then the download frame sits below the slides and above the deletion with its sentence', async () => {
    const placed = await placeFiles(env, alice, { 'index.html': 'x' })
    await publish(database, placed.slug, placed.deploymentId)

    const { status, html } = await page(`/my/slides/${placed.slug}`)

    expect(status).toBe(200)
    const slides = html.indexOf('data-deck-frame="slide"')
    const downloads = html.indexOf('data-deck-frame="downloads"')
    const deletion = html.indexOf('data-deck-frame="delete"')
    expect(slides).toBeGreaterThan(0)
    expect(downloads).toBeGreaterThan(slides)
    expect(deletion).toBeGreaterThan(downloads)
    expect(html).toContain('スライドのデータをダウンロードできます。')
  })

  it('F36-AC42: Given a published slide, When its page opens, Then the download frame has one link to the article on taking a zip, and it is not among the downloads', async () => {
    const placed = await placeFiles(env, alice, { 'index.html': 'x' })
    await publish(database, placed.slug, placed.deploymentId)

    const { html } = await page(`/my/slides/${placed.slug}`)
    const frame = html.slice(html.indexOf('data-deck-frame="downloads"'))
    const inFrame = frame.slice(0, frame.indexOf('</section>'))

    expect(inFrame.match(/href="\/help\/[^"]*"/g)).toEqual([
      'href="/help/account/export-slide"',
    ])
  })

  it('F35-AC4, F35-AC5, F35-AC11: Given a published slide with a newer version and an article, When its page opens, Then both zips, the article and the information are linked, and no past version is', async () => {
    const placed = await placeFiles(env, alice, { 'index.html': 'x' })
    await publish(database, placed.slug, placed.deploymentId)
    await placeFiles(env, alice, { 'index.html': 'y' }, placed.slug)
    const [deck] = await orm.select({ id: decks.id }).from(decks)
    await keepArticle(database, {
      deckId: deck!.id,
      body: 'text',
      status: 'draft',
      citations: [],
      now: 1,
    })

    const { html } = await page(`/my/slides/${placed.slug}`)
    const links = hrefs(html, 'data-deck-frame="downloads"')

    expect(links).toEqual([
      `/my/slides/${placed.slug}/export/published.zip`,
      `/my/slides/${placed.slug}/export/prepared.zip`,
      `/my/slides/${placed.slug}/export/article.md`,
      `/my/slides/${placed.slug}/export/slide.json`,
    ])
  })

  it('F35-AC4, F35-AC11: Given a published slide with nothing newer and no article, When its page opens, Then there is no prepared and no article link', async () => {
    const placed = await placeFiles(env, alice, { 'index.html': 'x' })
    await publish(database, placed.slug, placed.deploymentId)

    const { html } = await page(`/my/slides/${placed.slug}`)
    const links = hrefs(html, 'data-deck-frame="downloads"')

    expect(links).toEqual([
      `/my/slides/${placed.slug}/export/published.zip`,
      `/my/slides/${placed.slug}/export/slide.json`,
    ])
  })

  it('F35-AC30: Given English, When the page opens, Then the frame and its links are in English', async () => {
    const placed = await placeFiles(env, alice, { 'index.html': 'x' })
    await publish(database, placed.slug, placed.deploymentId)

    const { html } = await page(`/my/slides/${placed.slug}`, alice, 'en')

    expect(html).toContain('<h2>Download</h2>')
    expect(html).toContain('Published version (zip)')
    expect(html).toContain('Slide information (JSON)')
    expect(html).not.toContain('公開中の版(zip)')
  })
})

describe('設定の「データを書き出す」', () => {
  const seedMany = async (count: number) => {
    for (let index = 0; index < count; index++)
      await seedPublic(
        database,
        `deck-${String(index).padStart(2, '0')}`,
        1000 + index,
        `Talk ${index}`,
        OWNER_ID,
        `talk-${String(index).padStart(2, '0')}`,
      )
  }

  it('F35-AC14, F35-AC17: Given a person with a picture, When settings open, Then the frame sits under the account and above leaving, with the account information and the picture', async () => {
    await orm
      .insert(profilePictures)
      .values({ user_id: OWNER_ID, uploaded_at: 5 })

    const { status, html } = await page('/settings')

    expect(status).toBe(200)
    const account = html.indexOf('id="account"')
    const exported = html.indexOf('id="export"')
    const leave = html.indexOf('id="leave"')
    expect(exported).toBeGreaterThan(account)
    expect(leave).toBeGreaterThan(exported)
    expect(hrefs(html, 'id="export"').slice(0, 2)).toEqual([
      '/account/export/account.json',
      '/account/export/picture',
    ])
    expect(html).toContain('アカウントの情報(JSON)')
    expect(html).toContain('プロフィール画像')
  })

  it('F35-AC17: Given no uploaded picture, When settings open, Then there is no picture link', async () => {
    const { html } = await page('/settings')

    expect(hrefs(html, 'id="export"')).toEqual(['/account/export/account.json'])
  })

  it('F35-AC15: Given slides that are public, stopped, never published and hidden, When settings open, Then each is one row with its name, its state and its links', async () => {
    await seedMany(1)
    const stopped = await seedPublic(
      database,
      'stopped',
      500,
      'Stopped talk',
      OWNER_ID,
      'stopped',
    )
    await orm
      .update(decks)
      .set({
        public_deployment_id: null,
        resume_deployment_id: stopped,
        paused_at: 9,
      })
      .where(eq(decks.id, 'stopped'))
    const hidden = await seedPublic(
      database,
      'hidden',
      400,
      'Hidden talk',
      OWNER_ID,
      'hidden',
    )
    expect(hidden).toBeTruthy()
    await orm
      .update(decks)
      .set({ hidden_at: 4, hidden_reason: 'r', hidden_by: 'op' })
      .where(eq(decks.id, 'hidden'))
    const draft = await placeFiles(env, alice, { 'index.html': 'draft' })

    const { html } = await page('/settings')

    const rows = html.split('class="export-slide"').slice(1)
    expect(rows).toHaveLength(4)
    const rowOf = (name: string) => rows.find((row) => row.includes(name))!
    expect(rowOf('Talk 0')).toContain('公開中')
    expect(rowOf('Stopped talk')).toContain('公開を止めています')
    expect(rowOf('Hidden talk')).toContain('運営が非表示にしています')
    expect(rowOf('Hidden talk')).toContain(
      '/my/slides/hidden/export/published.zip',
    )
    expect(rowOf(draft.slug)).toContain('まだ公開していません')
    expect(rowOf(draft.slug)).toContain(
      `/my/slides/${draft.slug}/export/prepared.zip`,
    )
    expect(rowOf(draft.slug)).not.toContain('published.zip')
  })

  it("F35-AC15: Given another person's slides, When settings open, Then none is listed", async () => {
    await seedPublic(database, 'bobs', 1, 'Bobs talk', INVITED_ID, 'bobs')

    const { html } = await page('/settings')

    expect(html).not.toContain('Bobs talk')
    expect(html).not.toContain('/my/slides/bobs/')
  })

  it('F35-AC16: Given 45 slides, When settings open, Then the first page lists 20 and links to the next, and the last page lists the rest', async () => {
    await seedMany(45)

    const first = await page('/settings')
    const second = await page('/settings?export=2')
    const last = await page('/settings?export=3')

    const count = (html: string) =>
      html.split('class="export-slide"').length - 1
    expect([count(first.html), count(second.html), count(last.html)]).toEqual([
      20, 20, 5,
    ])
    expect(first.html).toContain('href="/settings?lang=ja&amp;export=2#export"')
    expect(first.html).not.toContain('rel="prev"')
    expect(second.html).toContain('rel="prev"')
    expect(second.html).toContain('rel="next"')
    expect(last.html).not.toContain('rel="next"')
    expect(first.html).toContain('1 / 3 ページ')
  })

  it.each(['0', '-1', 'abc', '1.5', '99999999', '2; drop'])(
    'F35-AC16: Given the page %j, When settings open, Then a page is shown and nothing breaks',
    async (value) => {
      await seedMany(25)

      const { status, html } = await page(
        `/settings?export=${encodeURIComponent(value)}`,
      )

      expect(status).toBe(200)
      expect(html).toContain('class="export-slide"')
    },
  )

  it('F35-AC16: Given 20 slides exactly, When settings open, Then there is one page and no pager', async () => {
    await seedMany(20)

    const { html } = await page('/settings')

    expect(html.split('class="export-slide"').length - 1).toBe(20)
    expect(html).not.toContain('class="export-pages"')
  })

  it('F35-AC30: Given English, When settings open, Then the frame is in English', async () => {
    await seedMany(1)

    const { html } = await page('/settings', alice, 'en')

    expect(html).toContain('<h2>Export your data</h2>')
    expect(html).toContain('Account information (JSON)')
    expect(html).toContain('Export with an AI agent')
  })

  it('F35-AC31: Given a slide with a long name, When settings open, Then each slide is one group in a list, not a table', async () => {
    await seedMany(3)

    const { html } = await page('/settings')
    const frame = html.slice(
      html.indexOf('id="export"'),
      html.indexOf('id="leave"'),
    )

    expect(frame).not.toContain('<table')
    expect(frame).toContain('class="export-slides"')
  })

  it('F35-AC26: Given a suspended person, When settings open, Then they get the suspension page and no export', async () => {
    await orm.insert(suspensions).values({
      user_id: OWNER_ID,
      reason: 'x',
      suspended_at: 1,
      suspended_by: 'op',
    })

    const { status, html } = await page('/settings')

    expect(status).toBe(403)
    expect(html).not.toContain('/account/export/')
  })
})

describe('退会の前の案内', () => {
  it('F28-AC115: Given settings, When the leaving form is drawn, Then the sentence and the link to the export place are above the confirmation field', async () => {
    const { html } = await page('/settings')

    const sentence = html.indexOf('退会の前に、データを書き出せます。')
    const field = html.indexOf('id="leave-confirm"')
    expect(sentence).toBeGreaterThan(html.indexOf('id="leave"'))
    expect(sentence).toBeLessThan(field)
    expect(html.slice(sentence, field)).toContain('href="/settings#export"')
  })

  it('F28-AC115: Given English, When the leaving form is drawn, Then the sentence is in English', async () => {
    const { html } = await page('/settings', alice, 'en')

    expect(html).toContain('Before you leave, you can export your data.')
  })

  it('F28-AC115: Given a suspended person, When their page shows how to leave, Then it does not link to the export', async () => {
    await orm.insert(suspensions).values({
      user_id: OWNER_ID,
      reason: 'x',
      suspended_at: 1,
      suspended_by: 'op',
    })

    const { html } = await page('/my/slides')

    expect(html).toContain('leave-confirm')
    expect(html).not.toContain('退会の前に、データを書き出せます。')
  })
})
