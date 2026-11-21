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
  await add({ title: 'First' })
  await add({ title: 'Second' })
  await add({ title: 'Third' })
  const [, second] = await listLinks(db, 'talk')
  await form(`/slides/talk/links/${second?.id}/delete`, owner, {})
  await add({ title: 'Fourth' })
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

test('F27-AC17: Given links to be added and shown, When they are, Then the service makes no request to the target', async () => {
  await seedPublic(db, 'talk', 100, 'Talk')
  const spy = vi.spyOn(globalThis, 'fetch')
  try {
    await add({ url: 'https://unreachable.invalid/x' })
    await get('/slides/talk', owner)
    await get('/@owner/talk')
    expect(
      spy.mock.calls.filter(([input]) =>
        String(input instanceof Request ? input.url : input).includes(
          'unreachable.invalid',
        ),
      ),
    ).toEqual([])
  } finally {
    spy.mockRestore()
  }
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
