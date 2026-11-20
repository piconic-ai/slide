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
import { accounts, citations, decks } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedDeployment,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'

// F22-AC25 and F22-AC23: two authors each have a deck named "talk". The keys
// are random-looking and differ; only the slug is shared.

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = withInvited({
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env)

let alice = ''
let bob = ''
let aliceDeployment = ''
let bobDeployment = ''

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  alice = await signIn(env, 'alice')
  bob = await signIn(env, 'bob', { id: INVITED_ID })
  aliceDeployment = await seedPublic(
    db,
    'k-alice',
    1,
    'Alice talk',
    OWNER_ID,
    'talk',
  )
  bobDeployment = await seedPublic(
    db,
    'k-bob',
    1,
    'Bob talk',
    INVITED_ID,
    'talk',
  )
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const send = (
  path: string,
  cookie: string,
  init: { method?: string; body?: string; json?: boolean } = {},
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Cookie: cookie,
        ...(init.method ? { Origin: TEST_ORIGIN } : {}),
        'Content-Type': init.json
          ? 'application/json'
          : 'application/x-www-form-urlencoded',
      },
      body: init.body,
    }),
    env,
  )
const deckRow = async (id: string) =>
  (await orm.select().from(decks).where(eq(decks.id, id)))[0]

test('F22-AC25: Given two authors with a deck of one slug, When each share URL is opened, Then it shows that author’s deck', async () => {
  const a = await (await send('/@alice/talk', '')).text()
  const b = await (await send('/@bob/talk', '')).text()

  expect(a).toContain('Alice talk')
  expect(a).not.toContain('Bob talk')
  expect(b).toContain('Bob talk')
  expect(b).not.toContain('Alice talk')
})

test('F22-AC23: Given two decks of one slug, When an author opens the management page and history, Then only their own deployments show', async () => {
  const page = await (await send('/slides/talk', alice)).text()
  const history = await (await send('/api/slides/talk/deployments', bob)).json()

  expect(page).toContain('Alice talk')
  expect(page).not.toContain('Bob talk')
  expect(page).not.toContain(bobDeployment)
  expect(JSON.stringify(history)).toContain(bobDeployment)
  expect(JSON.stringify(history)).not.toContain(aliceDeployment)
})

test('F22-AC23: Given two decks of one slug, When one author pauses and then deletes theirs, Then the other deck stays public and unchanged', async () => {
  const state = (await (
    await send('/api/slides/talk/publication', alice)
  ).json()) as { publication: { revision: number } }
  const paused = await send('/api/slides/talk/publication', alice, {
    method: 'POST',
    json: true,
    body: JSON.stringify({
      action: 'pause',
      expectedRevision: state.publication.revision,
    }),
  })
  expect(paused.status).toBe(200)
  expect((await deckRow('k-alice'))?.paused_at).not.toBeNull()
  expect((await deckRow('k-bob'))?.paused_at).toBeNull()
  expect((await send('/@bob/talk', '')).status).toBe(200)

  const deleted = await send('/slides/talk/delete', alice, {
    method: 'POST',
    body: new URLSearchParams({ confirm: 'talk' }).toString(),
  })
  expect(deleted.status).toBe(303)
  expect((await deckRow('k-alice'))?.deleted_at).not.toBeNull()
  expect((await deckRow('k-bob'))?.deleted_at).toBeNull()
  expect((await send('/@bob/talk', '')).status).toBe(200)
})

test('F22-AC23: Given two decks of one slug, When an author asks for the other’s version in their own viewer, Then it is 404', async () => {
  const own = await send(`/@bob/talk?v=${bobDeployment}`, bob)
  const other = await send(`/@bob/talk?v=${aliceDeployment}`, bob)

  expect(own.status).toBe(200)
  expect(other.status).toBe(404)
})

test('Given a slug that only another author has, When an author uses it on management pages, Then it looks like an unknown deck', async () => {
  await seedPublic(db, 'k-solo', 1, 'Solo', OWNER_ID, 'only-alice')

  const page = await send('/slides/only-alice', bob)
  const api = await send('/api/slides/only-alice/publication', bob)
  const missing = await send('/slides/nobody-has-this', bob)

  for (const response of [page, api]) expect(response.status).toBe(404)
  expect(missing.status).toBe(404)
})

test('Given a deck whose key differs from its slug, When its publication form is posted, Then the page it returns to is addressed by slug', async () => {
  const response = await send('/slides/talk/publication', alice, {
    method: 'POST',
    body: new URLSearchParams({
      action: 'pause',
      expectedRevision: String((await deckRow('k-alice'))?.revision),
    }).toString(),
  })

  expect(response.headers.get('location')).toBe('/slides/talk?result=applied')
})
