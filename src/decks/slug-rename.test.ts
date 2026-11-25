import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { decks } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { deckIdSchema, deckSlugSchema } from './deck-id'
import { canRenameDeck, renameDeck } from './rename-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited(testEnv(platform.env))
let cookie = ''

const rename = (
  deck: string,
  slug: string,
  headers: Record<string, string> = {},
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/slides/${deck}/slug`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: new URLSearchParams({ slug }).toString(),
    }),
    env,
  )
const page = (path: string, as = cookie) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: as } }),
    env,
  )
const slugs = async (owner = OWNER_ID) =>
  (
    await db
      .select({ slug: decks.slug })
      .from(decks)
      .where(eq(decks.owner_user_id, owner))
      .orderBy(decks.slug)
  ).map(({ slug }) => slug)
const text = async (response: Response) =>
  (await response.text()).replace(/\s+/g, ' ')

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  cookie = await signIn(env, 'alice')
  await seedDeck(database, 'key-talk', OWNER_ID, 'talk')
})
afterAll(() => platform.dispose())

test('F22-AC14: Given slides that were never published, When the author changes the URL name on their page, Then the page moves to the new name, says so, and the old name is gone', async () => {
  const before = await text(await page('/slides/talk'))
  expect(before).toContain('<form method="post" action="/slides/talk/slug"')
  expect(before).toMatch(/<input[^>]*name="slug"[^>]*value="talk"/)

  const response = await rename('talk', 'kaigi-2026')

  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe(
    '/slides/kaigi-2026?slug=renamed',
  )
  expect(await slugs()).toEqual(['kaigi-2026'])
  const after = await page('/slides/kaigi-2026?slug=renamed')
  expect(after.status).toBe(200)
  const body = await text(after)
  expect(body).toContain('URL の末尾を変えました。')
  // The field for the end of the URL holds the new name, after the start of it.
  expect(body).toMatch(/<input\s+id="url-name"[^>]*value="kaigi-2026"/)
  expect(body).toContain('slide.example/@alice/')
  expect((await page('/slides/talk')).status).toBe(404)
})

test('F22-AC14: Given a received version that is not published yet, When the author changes the URL name, Then it still changes and the version stays with the slides', async () => {
  const version = await seedDeployment(database, 'key-talk')

  expect((await rename('talk', 'renamed')).headers.get('location')).toBe(
    '/slides/renamed?slug=renamed',
  )

  expect(await text(await page('/slides/renamed'))).toContain(version)
})

describe('slides that were published', () => {
  test.each([
    [
      'public now',
      async (version: string) =>
        db
          .update(decks)
          .set({ public_deployment_id: version, first_published_at: 5 }),
    ],
    [
      'published once and stopped since',
      async (version: string) =>
        db.update(decks).set({
          paused_at: 9,
          resume_deployment_id: version,
          first_published_at: 5,
        }),
    ],
    [
      'published once, stopped, with nothing to resume',
      async () => db.update(decks).set({ paused_at: 9, first_published_at: 5 }),
    ],
    [
      'public since before publications were dated',
      async (version: string) =>
        db.update(decks).set({ public_deployment_id: version }),
    ],
  ])(
    'F22-AC14: Given slides %s, When the author tries to change the URL name, Then it is refused, the name stays, and the page offers no way to change it',
    async (_name, publish) => {
      await publish(await seedDeployment(database, 'key-talk'))

      const response = await rename('talk', 'other')

      expect(response.headers.get('location')).toBe(
        '/slides/talk?slug=published',
      )
      expect(await slugs()).toEqual(['talk'])
      const body = await text(await page('/slides/talk?slug=published'))
      expect(body).toContain('公開したスライドの URL は変えられません。')
      expect(body).not.toContain('action="/slides/talk/slug"')
      // F22-AC46: no field and no link to one after publication
      expect(body).not.toMatch(/<input[^>]*id="url-name"/)
      expect(body).not.toContain('<details class="url-change"')
    },
  )

  test('F22-AC14: Given the slides are published while the author is typing a new name, When the change arrives, Then the publication wins and the name stays', async () => {
    const version = await seedDeployment(database, 'key-talk')
    expect(await canRenameDeck(database, 'key-talk')).toBe(true)
    await db
      .update(decks)
      .set({ public_deployment_id: version, first_published_at: 5 })

    expect(
      await renameDeck(database, {
        ownerUserId: OWNER_ID,
        deckId: deckIdSchema.parse('key-talk'),
        slug: deckSlugSchema.parse('late'),
      }),
    ).toBe('published')
    expect(await canRenameDeck(database, 'key-talk')).toBe(false)
    expect(await slugs()).toEqual(['talk'])
  })
})

test('F21-AC65: Given the author types "communities", When the change is sent, Then it is refused as reserved and the name stays', async () => {
  const response = await rename('talk', 'communities')

  expect(response.headers.get('location')).toBe('/slides/talk?slug=reserved')
  expect(await slugs()).toEqual(['talk'])
})

test.each(['following', 'followers', 'new', 'connect'])(
  'F21-AC20: Given the author types the reserved name %j, When the change is sent, Then it is refused with the reason and nothing is added to the name',
  async (reserved) => {
    const response = await rename('talk', reserved)

    expect(response.headers.get('location')).toBe('/slides/talk?slug=reserved')
    expect(await slugs()).toEqual(['talk'])
    expect(await text(await page('/slides/talk?slug=reserved'))).toContain(
      'その名前は、サービスが使っているので選べません。',
    )
  },
)

test.each([
  '',
  'My Talk',
  'talk_2',
  '-talk',
  'talk-',
  '日本語',
  'a'.repeat(65),
  '../x',
  '<b>x</b>',
])(
  'Given the author types %j, which is not a URL name, When the change is sent, Then it is refused as invalid and the name stays',
  async (typed) => {
    const response = await rename('talk', typed)

    expect(response.headers.get('location')).toBe('/slides/talk?slug=invalid')
    expect(await slugs()).toEqual(['talk'])
  },
)

test('F22-AC13: Given the author has other slides of that name, When they change to it, Then it is refused as taken and both keep their names', async () => {
  await seedDeck(database, 'key-other', OWNER_ID, 'other')

  const response = await rename('talk', 'other')

  expect(response.headers.get('location')).toBe('/slides/talk?slug=taken')
  expect(await slugs()).toEqual(['other', 'talk'])
  expect(await text(await page('/slides/talk?slug=taken'))).toContain(
    '同じ名前のスライドが、もうあります。',
  )
})

test('Given slides of that name wait to be purged, When the author changes to it, Then it is refused as taken', async () => {
  await seedDeck(database, 'key-gone', OWNER_ID, 'gone')
  await db.update(decks).set({ deleted_at: 3 }).where(eq(decks.id, 'key-gone'))

  expect((await rename('talk', 'gone')).headers.get('location')).toBe(
    '/slides/talk?slug=taken',
  )
})

test('F22-AC25: Given another author has slides of that name, When the author changes to it, Then it changes: names are each author\’s own', async () => {
  await seedDeck(database, 'key-bob', INVITED_ID, 'shared')

  expect((await rename('talk', 'shared')).headers.get('location')).toBe(
    '/slides/shared?slug=renamed',
  )
  expect(await slugs(INVITED_ID)).toEqual(['shared'])
})

test('Given the author sends the name the slides already have, When it arrives, Then nothing changes and the page is shown again', async () => {
  expect((await rename('talk', '  talk ')).headers.get('location')).toBe(
    '/slides/talk?slug=renamed',
  )
  expect(await slugs()).toEqual(['talk'])
})

test('F22-AC17: Given slides of another author, When someone else tries to change their URL name, Then it looks like no slides and nothing changes', async () => {
  await seedDeck(database, 'key-bob', INVITED_ID, 'bobs')

  const response = await rename('bobs', 'mine-now')

  expect(response.status).toBe(404)
  expect(await slugs(INVITED_ID)).toEqual(['bobs'])
})

test.each([
  ['nobody is signed in', { Cookie: '' }, 401],
  ['the form comes from another site', { Origin: 'https://evil.example' }, 403],
])(
  'Given %s, When a change of the URL name is sent, Then it is refused and the name stays',
  async (_name, headers, status) => {
    expect((await rename('talk', 'stolen', headers)).status).toBe(status)
    expect(await slugs()).toEqual(['talk'])
  },
)

test('Given slides that wait to be purged, When their URL name is changed, Then it looks like no slides', async () => {
  await db.update(decks).set({ deleted_at: 3 })

  expect((await rename('talk', 'other')).status).toBe(404)
})

test('Given the store is asked to rename slides of someone else or none, When it runs, Then nothing is renamed', async () => {
  const slug = deckSlugSchema.parse('other')

  expect(
    await renameDeck(database, {
      ownerUserId: INVITED_ID,
      deckId: deckIdSchema.parse('key-talk'),
      slug,
    }),
  ).toBe('missing')
  expect(
    await renameDeck(database, {
      ownerUserId: OWNER_ID,
      deckId: deckIdSchema.parse('no-such-key'),
      slug,
    }),
  ).toBe('missing')
  expect(await slugs()).toEqual(['talk'])
})

test('Given the page in English, When it follows a refused change, Then the reason and the form are in English', async () => {
  const body = await text(await page('/slides/talk?slug=taken&lang=en'))

  expect(body).toContain('You already have slides of that name.')
  expect(body).toContain('>URL</label>')
  expect(body).toContain(
    'Only the end can be changed, and only before you publish.',
  )
  // F22-AC46: a refused change comes back with the field open
  expect(body).toMatch(/<details class="url-change"\s+open/)
})
