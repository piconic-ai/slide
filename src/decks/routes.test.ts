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
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks } from '../db/schema'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  resetTables,
  seedDeck,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = testEnv(platform.env)

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db))
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const request = (path: string, init: RequestInit = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, init), env)
const listDecks = (session: string) =>
  request('/api/slides', { headers: { Cookie: session } })
/** The form that used to connect a slide to a GitHub repository. */
const connect = (session: string, origin = TEST_ORIGIN) =>
  request('/my/slides/connect', {
    method: 'POST',
    headers: {
      Cookie: session,
      Origin: origin,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      deck: 'talk',
      repository: 'piconic-ai/slide',
      branches: 'main',
    }),
  })

test.each([
  ['the signed-in author', true],
  ['nobody signed in', false],
])(
  'F22-AC29: Given %s, When the form that connected a repository is posted, Then it answers 404, sends nobody to GitHub, and creates no slide',
  async (_name, signedIn) => {
    const session = signedIn ? await signIn(env) : ''

    const response = await connect(session)

    expect(response.status).toBe(404)
    expect(response.headers.get('location')).toBeNull()
    expect(await orm.$count(decks)).toBe(0)
  },
)

test('F22-AC29: Given a slide named connect, When its author posts to /my/slides/connect, Then it still answers 404 and the slide is unchanged', async () => {
  await seedDeck(db, 'connect')
  const before = await orm.select().from(decks)
  const session = await signIn(env)

  expect((await connect(session)).status).toBe(404)
  expect(await orm.select().from(decks)).toEqual(before)
})

test('F22-AC23: Given two authors with slides, When one lists their slides through the API, Then only the names of their own live slides are returned, in order', async () => {
  await seedDeck(db, 'zeta')
  await seedDeck(db, 'alpha')
  await seedDeck(db, 'theirs', INVITED_ID)
  await seedDeck(db, 'gone')
  await orm.update(decks).set({ deleted_at: 1 }).where(eq(decks.id, 'gone'))
  const session = await signIn(env)

  const response = await listDecks(session)

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(await response.json()).toEqual({
    decks: [{ deck: 'alpha' }, { deck: 'zeta' }],
  })
})

test('F22-AC23: Given an author with no slides, When they list their slides through the API, Then the list is empty', async () => {
  const session = await signIn(env)

  expect(await (await listDecks(session)).json()).toEqual({ decks: [] })
})

test('given no owner session, when decks are listed, then it is refused', async () => {
  expect((await listDecks('')).status).toBe(401)
})
