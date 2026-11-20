import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { accounts, citations, decks, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { recordCitations } from '../citations/citation-store'
import { DECKS_SHOWN } from '../citations/citing'
import { readCitedBy, readCites } from '../citations/store'
import { listPosts } from '../reactions/store'
import { deckIdSchema, deckSlugSchema } from './binding'
import { applyOperatorCommand } from '../publication/takedown-store'
import { ACCESS_TOKEN_HEADER } from '../operator/access'
import {
  accessTeam,
  AUDIENCE,
  OPERATOR_ORIGIN,
  TEAM,
} from '../operator/test-support'
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

const team = await accessTeam()
vi.mock('../operator/access-client', () => ({ accessKeys: () => team.keys }))

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  OPERATOR_ORIGIN,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUDIENCE,
} as unknown as Env

const READER_ID = '999'
const X_POST = 'https://x.com/kfly8/status/1830000000000000000'

// The deck under test has a key that is not its name: the share URL is
// /@owner/intro, and rows in other tables point at k-123.
let cookie = ''
let citing = ''

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  cookie = await signIn(env)
  await orm
    .insert(accounts)
    .values({ user_id: READER_ID, handle: 'reader', created_at: 1 })
  await seedPublic(db, 'k-123', 1, 'Intro', OWNER_ID, 'intro')
  // A public deck of another author that links to the deck, with a key of
  // its own as well.
  citing = await seedPublic(db, 'k-456', 2, 'Reply', READER_ID, 'reply')
  await orm.insert(citations).values({
    deployment_id: citing,
    target_handle: 'owner',
    target_slug: 'intro',
    target_page: 6,
  })
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const view = (path: string) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)
const owned = (path: string) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, { headers: { cookie } }),
    env,
  )

test('Given a deck whose key differs from its slug, When the share URL is opened, Then the deck opens by its slug and not by its key', async () => {
  expect((await view('/@owner/intro')).status).toBe(200)
  expect((await view('/@owner/k-123')).status).toBe(404)
})

test('Given a deck whose key differs from its slug, When the owner adds a post by the slug, Then the post is stored under the deck’s key', async () => {
  const added = await server.fetch(
    new Request(`${TEST_ORIGIN}/slides/intro/reactions`, {
      method: 'POST',
      headers: {
        cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ url: X_POST }),
    }),
    env,
  )
  expect(added.headers.get('location')).toContain('result=added')

  expect(await listPosts(db, deckIdSchema.parse('k-123'))).toHaveLength(1)
  expect(await listPosts(db, deckIdSchema.parse('intro'))).toEqual([])
})

test('F24-AC11: Given a deck another deck cites, When the owner opens the deck’s page by slug, Then the citing deck is listed, and the deck’s key opens nothing', async () => {
  const page = await (await owned('/slides/intro')).text()

  expect(page).toContain('href="/@reader/reply"')
  expect((await owned('/slides/k-123')).status).toBe(404)
})

test('Given a deck that cites a deck, When lists show them, Then each names the deck by slug, never by key', async () => {
  // The decks citing the cited deck, and the decks the citing deck cites,
  // as the viewer reads them.
  const citedBy = await readCitedBy(
    db,
    'owner',
    deckSlugSchema.parse('intro'),
    DECKS_SHOWN,
    null,
  )
  const cites = await readCites(db, citing, null)
  // The author's public list and the front page's list.
  const profile = await (await view('/@owner')).text()
  const recent = await (await view('/api/public/slides')).text()

  expect(citedBy.decks.map(({ handle, slug }) => [handle, slug])).toEqual([
    ['reader', 'reply'],
  ])
  expect(cites.map(({ handle, slug }) => [handle, slug])).toEqual([
    ['owner', 'intro'],
  ])
  for (const page of [profile, recent])
    expect(page).not.toMatch(/\/@(owner|reader)\/k-\d+/)
  expect(profile).toContain('href="/@owner/intro"')
  expect(recent).toContain('"/@owner/intro"')
})

test('Given an upload of a deck whose key differs from its slug, When its links are recorded, Then a link to its own share URL is not a citation', async () => {
  const deployment = await seedDeployment(db, 'k-123')
  const body = `<a href="${TEST_ORIGIN}/@owner/intro/2">self</a>
    <a href="${TEST_ORIGIN}/@reader/reply">other</a>`
  const key = `${deployment}/0/lease`
  await platform.env.UPLOADS.put(key, body)
  await orm.insert(uploadFiles).values({
    deployment_id: deployment,
    id: '0',
    path: 'index.html',
    size: body.length,
    sha256: 'x',
    media_type: 'text/html; charset=utf-8',
    object_key: key,
  })

  await recordCitations(env, deployment)

  const kept = await orm
    .select()
    .from(citations)
    .where(eq(citations.deployment_id, deployment))
  expect(kept.map((row) => `${row.target_handle}/${row.target_slug}`)).toEqual([
    'reader/reply',
  ])
})

test('Given a public deck whose key differs from its slug, When the owner opens its page by slug, Then the share URL shown names the slug', async () => {
  const page = await (await owned('/slides/intro')).text()

  expect(page).toContain(`${TEST_ORIGIN}/@owner/intro`)
  expect(page).not.toContain(`${TEST_ORIGIN}/@owner/k-123`)
})

test('Given a hidden deck whose key differs from its slug, When the operator lists hidden decks, Then the list shows the slug and releases by key', async () => {
  await applyOperatorCommand(db, {
    deckId: 'k-123',
    command: { kind: 'hide', reason: 'spam', operator: 'op' },
    now: 5,
  })

  const response = await server.fetch(
    new Request(`${OPERATOR_ORIGIN}/`, {
      headers: { [ACCESS_TOKEN_HEADER]: await team.sign() },
    }),
    env,
  )
  const page = await response.text()

  expect(page).toContain('<code>@owner/intro</code>')
  expect(page).not.toContain('@owner/k-123')
  expect(page).toContain('action="/takedowns/k-123/release"')
})

test('Given a deck whose key differs from its slug, When an operator hides it by its share URL, Then that deck is hidden', async () => {
  const hide = await server.fetch(
    new Request(`${OPERATOR_ORIGIN}/takedowns`, {
      method: 'POST',
      headers: {
        [ACCESS_TOKEN_HEADER]: await team.sign(),
        Origin: OPERATOR_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        target: `${TEST_ORIGIN}/@owner/intro`,
        reason: 'spam',
      }),
    }),
    env,
  )

  expect(hide.headers.get('location')).toContain('hidden')
  expect(await orm.select().from(decks).where(eq(decks.id, 'k-123'))).toEqual([
    expect.objectContaining({ hidden_reason: 'spam' }),
  ])
  expect((await view('/@owner/intro')).status).toBe(404)
})

test('Given the unique index on owner and slug, When one owner holds two decks with a slug, Then the second is refused, and another owner may use the slug', async () => {
  await expect(seedDeck(db, 'k-789', OWNER_ID, 'intro')).rejects.toThrow()
  await seedDeck(db, 'k-790', READER_ID, 'intro')
  // The refused deck left no row behind.
  expect(await orm.select().from(decks).where(eq(decks.id, 'k-789'))).toEqual(
    [],
  )

  expect(
    (
      await orm
        .select({ id: decks.id })
        .from(decks)
        .where(eq(decks.slug, 'intro'))
    )
      .map((row) => row.id)
      .sort(),
  ).toEqual(['k-123', 'k-790'])
})
