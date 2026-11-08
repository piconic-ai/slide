import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { accounts, decks, deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
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
  // Signing in records the handle "owner" from the stubbed GitHub login.
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

/** A deck whose public pointer names a ready deployment of the given age. */
async function seedPublic(
  deck: string,
  readyAt: number,
  title: string | null,
  ownerId = OWNER_ID,
) {
  await seedDeck(db, deck, ownerId)
  const id = await seedDeployment(db, deck)
  await orm.batch([
    orm
      .update(deployments)
      .set({ ready_at: readyAt, title })
      .where(eq(deployments.id, id)),
    orm
      .update(decks)
      .set({ public_deployment_id: id })
      .where(eq(decks.id, deck)),
  ])
  return id
}

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

test('Given public, draft, paused and deleted decks of two authors, When the top page is opened, Then only public decks are listed newest first with their authors', async () => {
  await seedPublic('old', 100, 'Old talk')
  await seedPublic('theirs', 150, '<b>Bold</b> & co', OTHER_ID)
  await seedPublic('new', 200, null)
  await seedHidden()
  const response = await view('/')
  expect(response.status).toBe(200)
  const page = await response.text()
  expect(cardLinks(page)).toEqual([
    '/@owner/new',
    '/@other/theirs',
    '/@owner/old',
  ])
  expect(page).toContain('>Old talk</a')
  // An untitled deck is named by its ID; titles are escaped as text.
  expect(page).toContain('>new</a')
  expect(page).toContain('&lt;b&gt;Bold&lt;/b&gt; &amp; co')
  expect(page).toContain('href="/@other">@other</a>')
  expect(page).toContain('GitHub ではじめる')
  expect(response.headers.get('X-Robots-Tag')).toBeNull()
})

test('Given more public decks than the top page shows, When it is opened, Then only the most recent are listed', async () => {
  for (let index = 0; index < RECENT_DECKS_SHOWN + 2; index++)
    await seedPublic(`deck-${index}`, 100 + index, null)
  const links = cardLinks(await (await view('/')).text())
  expect(links).toHaveLength(RECENT_DECKS_SHOWN)
  expect(links[0]).toBe(`/@owner/deck-${RECENT_DECKS_SHOWN + 1}`)
})

test('Given no public decks, When the top page is opened, Then it says there are none yet', async () => {
  await seedHidden()
  const page = await (await view('/')).text()
  expect(cardLinks(page)).toEqual([])
  expect(page).toContain('まだ公開されたスライドはありません')
})

test("Given decks of two authors, When an author's profile is opened, Then only that author's public decks are listed", async () => {
  await seedPublic('old', 100, 'Old talk')
  await seedPublic('theirs', 150, 'Theirs', OTHER_ID)
  await seedPublic('new', 200, 'New talk')
  await seedHidden()
  const response = await view('/@owner')
  expect(response.status).toBe(200)
  const page = await response.text()
  expect(page).toContain('<h1>@owner</h1>')
  expect(cardLinks(page)).toEqual(['/@owner/new', '/@owner/old'])
  expect(response.headers.get('X-Robots-Tag')).toBeNull()
  expect(cardLinks(await (await view('/@other')).text())).toEqual([
    '/@other/theirs',
  ])
})

test('Given the author is signed in, When they open their own profile, Then it links to deck management; others do not see it', async () => {
  await seedPublic('talk', 100, null)
  const manage = 'デッキを管理する'
  expect(await (await view('/@owner', owner)).text()).toContain(manage)
  expect(await (await view('/@owner')).text()).not.toContain(manage)
  expect(await (await view('/@other', owner)).text()).not.toContain(manage)
})

test('Given an author without public decks, When their profile is opened, Then it shows an empty list', async () => {
  const response = await view('/@quiet')
  expect(response.status).toBe(200)
  const page = await response.text()
  expect(cardLinks(page)).toEqual([])
  expect(page).toContain('公開中のスライドはまだありません')
})

test('Given a handle nobody holds, When its profile is opened, Then it is the unavailable page', async () => {
  const response = await view('/@nobody')
  expect(response.status).toBe(404)
  expect(await response.text()).toContain('この資料は公開されていません')
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
  await seedPublic('talk', 100, 'Good talk')
  const page = await (await view('/@owner/talk')).text()
  expect(page).toContain('<title>Good talk - @owner - Slide</title>')
  expect(page).toContain('<a href="/@owner">@owner</a>')
  expect(page).toContain('title="Good talk"')
})
