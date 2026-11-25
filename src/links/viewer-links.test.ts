import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { citations, decks, relatedLinks, suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { listLinks } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let owner = ''
let other = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  owner = await signIn(env)
  other = await signIn(env, 'other', { id: '2' })
})
afterAll(() => platform.dispose())

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
const text = async (response: Response | Promise<Response>) =>
  (await (await response).text()).replace(/\s+/g, ' ')

const add = (
  fields: Partial<Record<'kind' | 'url' | 'title', string>> = {},
  cookie = owner,
  deck = 'talk',
) =>
  form(`/slides/${deck}/links`, cookie, {
    kind: 'video',
    url: 'https://youtube.com/watch?v=1',
    title: 'The recording',
    ...fields,
  })
const rows = () => orm.select().from(relatedLinks).all()
const viewerLinks = async (cookie = '', path = '/@owner/talk') =>
  /<section class="related-links"[\s\S]*?<\/section>/.exec(
    await (await get(path, cookie)).text(),
  )?.[0] ?? ''

test('F27-AC2: Given links added in a given order, When a reader opens the viewer, Then they come in that order, even after one in the middle is removed and another added', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ title: 'First', url: 'https://youtu.be/1' })
  await add({ title: 'Second', url: 'https://youtu.be/2' })
  await add({ title: 'Third', url: 'https://youtu.be/3' })
  const [, second] = await listLinks(db, 'talk')
  await form(`/slides/talk/links/${second?.id}/delete`, owner, {})
  await add({ title: 'Fourth', url: 'https://youtu.be/4' })
  const section = await viewerLinks()
  const titles = [
    ...section.matchAll(/class="related-link-title">\s*([^<]*?)\s*</g),
  ].map((m) => m[1])
  expect(titles).toEqual(['First', 'Third', 'Fourth'])
})

test('F27-AC3: Given a link, When the viewer shows it, Then the icon, the kind name, the title and the host name are there', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({
    kind: 'article',
    url: 'https://zenn.dev/a/b?x=1',
    title: 'Notes',
  })
  const section = (await viewerLinks()).replace(/\s+>/g, '>')
  expect(section).toContain('<svg')
  expect(section).toContain('class="related-link-kind">記事<')
  expect(section).toContain('class="related-link-title">Notes<')
  expect(section).toContain('class="related-link-site">zenn.dev<')
  const english = await (await get('/@owner/talk?lang=en')).text()
  expect(english).toContain('Related links')
  expect(english).toContain('>Article<')
})

test('F27-AC9: Given a public deck with a link, When a reader who is not signed in opens it, Then the link is there with its target', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add()
  const section = await viewerLinks()
  expect(section).toContain('href="https://youtube.com/watch?v=1"')
  expect(section).toContain('The recording')
})

test('F27-AC10: Given a deck only its author may open, When the author and another person open the viewer, Then only the author sees the links', async () => {
  await seedDeck(db, 'talk')
  const deployment = await seedDeployment(db, 'talk')
  await add()
  const path = `/@owner/talk?v=${deployment}`
  expect(await viewerLinks(owner, path)).toContain('The recording')
  const stranger = await get(path, other)
  expect(stranger.status).toBe(404)
  expect(await stranger.text()).not.toContain('The recording')
  const reader = await get('/@owner/talk')
  expect(reader.status).toBe(404)
  expect(await reader.text()).not.toContain('The recording')
})

test('F27-AC11: Given a public deck with no links, When the viewer opens, Then there is no related-links section and no heading', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  const page = await (await get('/@owner/talk')).text()
  expect(page).not.toContain('data-viewer-frame="links"')
  expect(page).not.toContain('id="related-links"')
  expect(page).not.toContain('関連リンク')
})

test('F27-AC12: Given a link, When the viewer shows it, Then it carries rel="noopener nofollow ugc" and does not open a new tab', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add()
  const section = await viewerLinks()
  expect(section).toContain('rel="noopener nofollow ugc"')
  expect(section).not.toContain('target=')
})

test('F27-AC14: Given a link, When a new version is published, Then the viewer still shows it', async () => {
  const first = await seedPublic(db, 'talk', 100, 'Talk')
  await add()
  const second = await seedDeployment(db, 'talk')
  await orm
    .update(decks)
    .set({ public_deployment_id: second })
    .where(eq(decks.id, 'talk'))
  expect(second).not.toBe(first)
  expect(await viewerLinks()).toContain('The recording')
  expect(await rows()).toHaveLength(1)
})

test('F27-AC16: Given a link whose URL is a share URL, When it is added, Then no citation is recorded and the target does not list the deck', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await seedPublic(db, 'theirs', 100, 'Theirs', '2')
  await add({ url: `${TEST_ORIGIN}/@other/theirs/3`, title: 'Their page' })
  expect(await orm.select().from(citations).all()).toEqual([])
  const page = await (await get('/@other/theirs')).text()
  expect(page).not.toContain('/@owner/talk')
})

test('F27-AC4: Given a link, When the author removes it, Then the viewer no longer shows it', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add()
  expect(await viewerLinks()).toContain('The recording')
  const [link] = await listLinks(db, 'talk')
  await form(`/slides/talk/links/${link?.id}/delete`, owner, {})
  expect(await viewerLinks()).toBe('')
})

test.each([
  [
    'paused',
    async () => {
      await orm
        .update(decks)
        .set({
          resume_deployment_id: await seedDeployment(db, 'talk'),
          public_deployment_id: null,
          paused_at: 1,
        })
        .where(eq(decks.id, 'talk'))
    },
  ],
  [
    'hidden by an operator',
    async () => {
      await orm
        .update(decks)
        .set({ hidden_at: 1, hidden_reason: 'r', hidden_by: 'op' })
        .where(eq(decks.id, 'talk'))
    },
  ],
  [
    'of a suspended author',
    async () => {
      await orm.insert(suspensions).values({
        user_id: '722500',
        reason: 'r',
        suspended_at: 1,
        suspended_by: 'op',
      })
    },
  ],
])(
  'F27-AC10: Given a deck with a link that is %s, When a reader opens its share URL, Then the page is the unavailable one and the link is nowhere in it',
  async (_name, change) => {
    await seedPublic(db, 'talk', 100, 'Talk')
    await add()
    expect(await viewerLinks()).toContain('The recording')
    await change()
    const reader = await get('/@owner/talk')
    expect(reader.status).toBe(404)
    const body = await reader.text()
    expect(body).not.toContain('The recording')
    expect(body).not.toContain('youtube.com')
  },
)

/** Every href of the viewer's related links, as written in the HTML. */
const viewerHrefs = async () =>
  [...(await viewerLinks()).matchAll(/href="([^"]*)"/g)].map((m) => m[1])

test('F27-AC59: Given a link added with tracking parts, When the viewer, the manage page and the profile are opened, Then the link leads to the sanitized address and neither the address as added nor its compared form is in any of them', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  const added = 'https://www.example.com/a/?utm_source=x&b=1&fbclid=y#Top'
  await add({ kind: 'other', url: added })
  const [row] = await rows()
  expect(row).toMatchObject({
    url: added,
    normalized_url: 'https://example.com/a?b=1',
    sanitized_url: 'https://www.example.com/a/?b=1#Top',
  })
  expect(await viewerHrefs()).toEqual(['https://www.example.com/a/?b=1#Top'])
  for (const page of [
    await (await get('/@owner/talk')).text(),
    await (await get('/@owner/talk', owner)).text(),
    await (await get('/slides/talk', owner)).text(),
    await (await get('/@owner', owner)).text(),
  ]) {
    expect(page).not.toContain('utm_source')
    expect(page).not.toContain('fbclid')
    expect(page).not.toContain('https://example.com/a?b=1')
  }
})

test('F27-AC60: Given a Luma invitation and links with every tracking part, When the viewer shows them, Then tk and the tracking parts are left out and the other parts stay as added', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ url: 'https://lu.ma/abc?tk=secret&x=1' })
  await add({
    url: 'https://example.com/a?z=2&utm_medium=m&gclid=1&mc_cid=1&mc_eid=1&msclkid=1&yclid=1&dclid=1&igshid=1&ref_src=1&_ga=1&_gl=1&a=1',
  })
  await add({ url: 'https://example.com/b?tk=kept' })
  expect(await viewerHrefs()).toEqual([
    'https://lu.ma/abc?x=1',
    'https://example.com/a?z=2&amp;a=1',
    'https://example.com/b?tk=kept',
  ])
  expect(await viewerLinks()).not.toContain('secret')
})

test('F27-AC61: Given a Medium post with source and another site with source, When the viewer shows them, Then only Medium loses it', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ url: 'https://kfly8.medium.com/post-abc?source=rss' })
  await add({ url: 'https://example.com/a?source=x' })
  expect(await viewerHrefs()).toEqual([
    'https://kfly8.medium.com/post-abc',
    'https://example.com/a?source=x',
  ])
})

test('F27-AC52: Given a link with invisible and direction characters after its host, When the viewer shows it, Then its href holds them in their % form only', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({
    url: 'https://example.com/a‮b?x=​y#c⁦d',
    title: 'Notes',
  })
  expect(await viewerHrefs()).toEqual([
    'https://example.com/a%E2%80%AEb?x=%E2%80%8By#c%E2%81%A6d',
  ])
  expect(await viewerLinks()).not.toMatch(/[​‮⁦]/u)
})

test('F27-AC59: Given a link a Worker before migration 0052 added, When the viewer shows it, Then it leads to the address sanitized from its url', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await orm.insert(relatedLinks).values({
    id: 'old',
    deck_id: 'talk',
    kind: 'other',
    url: 'https://example.com/a?utm_source=x&b=1',
    normalized_url: 'https://example.com/a?b=1',
    title: null,
    position: 1,
    created_at: 1,
  })
  expect(await viewerHrefs()).toEqual(['https://example.com/a?b=1'])
})

test('F27-AC59: Given a stored link without a sanitized address whose url the parser cannot read, When the viewer opens, Then the page is still shown with the rest of its links', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  await add({ url: 'https://example.com/a?utm_source=x' })
  await orm.insert(relatedLinks).values({
    id: 'broken',
    deck_id: 'talk',
    kind: 'other',
    url: 'https://[broken?x=1',
    normalized_url: null,
    title: 'Broken',
    position: 99,
    created_at: 1,
  })
  const response = await get('/@owner/talk')
  expect(response.status).toBe(200)
  expect(await viewerHrefs()).toEqual([
    'https://example.com/a',
    'https://[broken?x=1',
  ])
})
