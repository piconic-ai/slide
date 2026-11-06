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
import { applyMigrations } from '../db/test-migrations'
import { readAccessFacts } from '../preview/access-store'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { markAccountDeleted, purgeDeletedDecks } from './deletion'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const bucket = platform.env.UPLOADS
const env = testEnv(platform.env)

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  const listed = await bucket.list()
  if (listed.objects.length)
    await bucket.delete(listed.objects.map(({ key }) => key))
  for (const [deck, owner] of [
    ['talk', OWNER_ID],
    ['slides', OWNER_ID],
    ['theirs', '1'],
  ] as const) {
    await seedDeck(db, deck, owner)
    await db
      .prepare(
        `INSERT INTO repository_bindings VALUES (?, '1', '2', 'piconic-ai/slide', '["refs/heads/main"]', ?, 1)`,
      )
      .bind(deck, owner)
      .run()
  }
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

async function publish(deck: string) {
  const id = await seedDeployment(db, deck)
  await bucket.put(`${id}/0/index.html`, 'a')
  await db
    .prepare('UPDATE decks SET public_deployment_id = ? WHERE id = ?')
    .bind(id, deck)
    .run()
  return id
}
const isPublic = async (deploymentId: string) =>
  (
    await readAccessFacts(db, {
      deploymentId,
      sessionToken: null,
      allowedOwnerId: OWNER_ID,
      now: 1,
    })
  ).isPublic
const liveDecks = async () =>
  (
    await db
      .prepare('SELECT id FROM decks WHERE deleted_at IS NULL ORDER BY id')
      .all<{ id: string }>()
  ).results.map(({ id }) => id)
const sessionsOf = async (user: string) =>
  (
    await db
      .prepare(
        'SELECT COUNT(*) AS count FROM owner_sessions WHERE github_user_id = ?',
      )
      .bind(user)
      .first<{ count: number }>()
  )?.count

test("given an owner with public decks, when the account is deleted, then all of the owner's decks stop and other accounts are untouched", async () => {
  const mine = await publish('talk')
  const theirs = await publish('theirs')
  const open = await seedDeployment(db, 'slides', 'uploading')
  await db.prepare("UPDATE decks SET deleted_at = 1 WHERE id = 'slides'").run()
  await db.batch([
    db.prepare(
      `INSERT INTO owner_sessions VALUES ('mine-1', '${OWNER_ID}', 'owner', 1, 999999999999), ('mine-2', '${OWNER_ID}', 'owner', 1, 999999999999), ('theirs-1', '1', 'other', 1, 999999999999)`,
    ),
  ])

  await markAccountDeleted(db, { ownerUserId: OWNER_ID, now: 1000 })

  expect(await liveDecks()).toEqual(['theirs'])
  expect(await isPublic(mine)).toBe(false)
  expect(await isPublic(theirs)).toBe(true)
  expect(await sessionsOf(OWNER_ID)).toBe(0)
  // A deck deleted earlier keeps its time, and its open upload is closed.
  const slides = await db
    .prepare(
      "SELECT deleted_at, (SELECT state FROM deployments WHERE id = ?) AS state FROM decks WHERE id = 'slides'",
    )
    .bind(open)
    .first()
  expect(slides).toEqual({ deleted_at: 1, state: 'expired' })
  expect(await sessionsOf('1')).toBe(1)
  const bindings = await db
    .prepare('SELECT deck_id FROM repository_bindings')
    .all<{ deck_id: string }>()
  expect(bindings.results).toEqual([{ deck_id: 'theirs' }])

  expect(await purgeDeletedDecks(env, 1000 + 3600, 3600)).toMatchObject({
    deployments: 2,
    decks: 2,
    failed: 0,
  })
  expect((await bucket.list()).objects.map(({ key }) => key)).toEqual([
    `${theirs}/0/index.html`,
  ])
})

const deleteAccount = (cookie: string, confirm: string, origin = TEST_ORIGIN) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/account/delete`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ confirm }),
    }),
    env,
  )
const deckList = (cookie: string) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/api/decks`, { headers: { Cookie: cookie } }),
    env,
  )

test('given the owner types another name, when the form is sent, then nothing is deleted', async () => {
  const cookie = await signIn(env)
  const response = await deleteAccount(cookie, 'someone')
  expect(response.status).toBe(400)
  expect(await response.text()).toContain('一致しません')
  expect(await liveDecks()).toEqual(['slides', 'talk', 'theirs'])
})

test('given a request from another origin, when the form is sent, then it is refused', async () => {
  const cookie = await signIn(env)
  expect(
    (await deleteAccount(cookie, 'owner', 'https://evil.example')).status,
  ).toBe(403)
  expect(await liveDecks()).toEqual(['slides', 'talk', 'theirs'])
})

test('given the owner types the login, when the form is sent, then the owner is signed out and a later sign-in has no decks', async () => {
  const cookie = await signIn(env)
  const response = await deleteAccount(cookie, 'Owner')
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('/')
  expect(
    response.headers
      .getSetCookie()
      .some((value) => /^__Host-slide_owner=;.*Max-Age=0/.test(value)),
  ).toBe(true)
  expect((await deckList(cookie)).status).toBe(401)

  const again = await signIn(env)
  expect(await (await deckList(again)).json()).toEqual({ decks: [] })
})
