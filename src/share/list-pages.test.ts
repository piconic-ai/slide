import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { accounts, decks, deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { RECENT_DECKS_SHOWN } from './list-pages'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
const OTHER_ID = '9'

let owner = ''
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  // Signing in records the handle "owner".
  owner = await signIn(env)
  await orm.insert(accounts).values([
    { user_id: OTHER_ID, handle: 'other', created_at: 1 },
    { user_id: '10', handle: 'quiet', created_at: 1 },
  ])
})
afterAll(() => platform.dispose())

const view = (path: string, cookie = '') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: cookie ? { Cookie: cookie } : {},
    }),
    env,
  )

/** Decks that have ready deployments but no public pointer. */
async function seedHidden() {
  await seedDeck(db, 'draft')
  await seedDeployment(db, 'draft')
  await seedDeck(db, 'paused')
  const paused = await seedDeployment(db, 'paused')
  await orm
    .update(decks)
    .set({ paused_at: 1, resume_deployment_id: paused })
    .where(eq(decks.id, 'paused'))
  await seedDeck(db, 'deleted')
  await seedDeployment(db, 'deleted')
  await orm.update(decks).set({ deleted_at: 1 }).where(eq(decks.id, 'deleted'))
}

const cardLinks = (page: string) =>
  [...page.matchAll(/<a class="card-title" href="([^"]+)"/g)].map(
    (match) => match[1],
  )

const recentDecks = async () => {
  const response = await view('/api/public/slides')
  expect(response.status).toBe(200)
  return {
    response,
    decks: (await response.json()) as { name: string; href: string }[],
  }
}

test('Given public, draft, paused and deleted decks of two authors, When the recent decks are requested, Then only public decks come newest first with their authors', async () => {
  await seedPublic(db, 'old', 100, 'Old talk')
  await seedPublic(db, 'theirs', 150, '<b>Bold</b> & co', OTHER_ID)
  await seedPublic(db, 'new', 200, null)
  await seedHidden()
  const { response, decks } = await recentDecks()
  expect(decks).toEqual([
    {
      // An untitled deck is named by its ID.
      name: 'new',
      href: '/@owner/new',
      handle: 'owner',
      slug: 'new',
      authorHref: '/@owner',
      publishedAt: '1970-01-01T00:03:20.000Z',
      coverUrl: expect.stringMatching(/^\/covers\/[0-9a-f-]{36}\.jpg$/),
      citedBy: 0,
    },
    expect.objectContaining({
      // Titles stay text; the page renders them escaped.
      name: '<b>Bold</b> & co',
      href: '/@other/theirs',
      authorHref: '/@other',
    }),
    expect.objectContaining({ name: 'Old talk', href: '/@owner/old' }),
  ])
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=60')
})

test('Given more public decks than the top page shows, When the recent decks are requested, Then only the most recent come', async () => {
  for (let index = 0; index < RECENT_DECKS_SHOWN + 2; index++)
    await seedPublic(db, `deck-${index}`, 100 + index, null)
  const { decks } = await recentDecks()
  expect(decks).toHaveLength(RECENT_DECKS_SHOWN)
  expect(decks[0]?.href).toBe(`/@owner/deck-${RECENT_DECKS_SHOWN + 1}`)
})

test('Given no public decks, When the recent decks are requested, Then the list is empty', async () => {
  await seedHidden()
  expect((await recentDecks()).decks).toEqual([])
})

test("Given decks of two authors, When an author's profile is opened, Then only that author's public decks are listed", async () => {
  await seedPublic(db, 'old', 100, 'Old talk')
  await seedPublic(db, 'theirs', 150, 'Theirs', OTHER_ID)
  await seedPublic(db, 'new', 200, 'New talk')
  await seedHidden()
  const response = await view('/@owner')
  expect(response.status).toBe(200)
  const page = await response.text()
  expect(page).toContain('<h1>@owner</h1>')
  expect(page).not.toMatch(/class="[^"]*color-block/)
  expect(page).not.toContain('color-block-purple')
  expect(page).toContain('class="deck-card"')
  expect(cardLinks(page)).toEqual(['/@owner/new', '/@owner/old'])
  // Covers load from the service shot path under the top-page img policy.
  expect(page).toMatch(
    /class="deck-cover">\s*<span class="deck-cover-name"[^>]*>[^<]+<\/span>\s*<img\s+data-cover\s+src="\/covers\/[0-9a-f-]{36}\.jpg"/,
  )
  expect(response.headers.get('Content-Security-Policy')?.split('; ')).toEqual(
    expect.arrayContaining(["img-src 'self' https://*.content.example"]),
  )
  expect(response.headers.get('X-Robots-Tag')).toBeNull()
  expect(cardLinks(await (await view('/@other')).text())).toEqual([
    '/@other/theirs',
  ])
})

test('Given a public deck that names its cover, When the profile is opened, Then the card loads that file from the deployment origin', async () => {
  const id = await seedPublic(db, 'talk', 100, 'Talk')
  await orm
    .update(deployments)
    .set({ cover_path: 'cover.png' })
    .where(eq(deployments.id, id))
  const page = await (await view('/@owner')).text()
  expect(page).toContain(`src="https://d-${id}.content.example/cover.png"`)
})

test('F21-AC23: Given the author is signed in, When they open their own profile, Then it shows what a reader sees, without the way to manage slides', async () => {
  await seedPublic(db, 'talk', 100, null)
  const ownPage = await (await view('/@owner', owner)).text()
  const readerPage = await (await view('/@owner')).text()
  for (const manage of ['スライドを管理する', 'href="/my/slides"'])
    expect(ownPage).not.toContain(manage)
  // Nothing but the follow form, which a reader has and the author does not.
  expect(cardLinks(ownPage)).toEqual(cardLinks(readerPage))
  expect(ownPage).toContain('class="deck-card"')
})

test('F21-AC23: Given an author without public decks who is signed in, When they open their own profile, Then the empty list has no way to manage slides', async () => {
  const page = await (await view('/@owner', owner)).text()
  expect(page).toContain('公開中のスライドはまだありません')
  expect(page).not.toContain('href="/my/slides"')
})

test('Given an author without public decks, When their profile is opened, Then it shows an empty list', async () => {
  const response = await view('/@quiet')
  expect(response.status).toBe(200)
  const page = await response.text()
  expect(cardLinks(page)).toEqual([])
  expect(page).not.toMatch(/class="[^"]*color-block/)
  expect(page).not.toContain('color-block-purple')
  expect(page).toMatch(
    /class="empty-state"[\s\S]*公開中のスライドはまだありません/,
  )
})

test('Given a handle nobody holds, When its profile is opened, Then the page says it was not found and does not speak of slides', async () => {
  const response = await view('/@nobody')
  expect(response.status).toBe(404)
  const page = await response.text()
  expect(page).toContain('このページは見つかりません')
  expect(page).not.toContain('資料')
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
})

test.each(['/@Owner', '/@owner/', '/%40owner'])(
  'Given the spelling %s, When opened, Then it redirects to the canonical profile',
  async (path) => {
    const response = await view(path)
    expect(response.status).toBe(301)
    expect(response.headers.get('Location')).toBe('/@owner')
  },
)

test("Given a public deck with a title, When its share URL is opened, Then the viewer names it and links to the author's profile", async () => {
  await seedPublic(db, 'talk', 100, 'Good talk')
  const page = await (await view('/@owner/talk')).text()
  expect(page).toContain('<title>Good talk - @owner - slide.community</title>')
  expect(page).toContain('<a class="author-link" href="/@owner">')
  expect(page).toContain('title="Good talk"')
})
