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
import { count, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, deployments, invitedEmails } from '../db/schema'
import { authSession, authUser } from '../db/auth-schema'
import server from '../app/routes'
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
import { markAccountDeleted, purgeDeletedDecks } from './deletion-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
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
  }
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

async function publish(deck: string) {
  const id = await seedDeployment(db, deck)
  await bucket.put(`${id}/0/index.html`, 'a')
  await orm
    .update(decks)
    .set({ public_deployment_id: id })
    .where(eq(decks.id, deck))
  return id
}
const isPublic = async (deploymentId: string) =>
  (
    await readAccessFacts(db, {
      deploymentId,
      sessionToken: null,
      now: 1,
    })
  ).isPublic
const liveDecks = async () =>
  (
    await orm
      .select({ id: decks.id })
      .from(decks)
      .where(isNull(decks.deleted_at))
      .orderBy(decks.id)
  ).map(({ id }) => id)
const sessionsOf = async (user: string) =>
  (
    await orm
      .select({ count: count() })
      .from(authSession)
      .where(eq(authSession.userId, user))
      .get()
  )?.count

test("F28-AC34: given an owner with public decks, when the account is deleted, then all of the owner's decks stop and other accounts are untouched", async () => {
  const mine = await publish('talk')
  const theirs = await publish('theirs')
  const open = await seedDeployment(db, 'slides', 'uploading')
  await orm.update(decks).set({ deleted_at: 1 }).where(eq(decks.id, 'slides'))
  await orm.batch([
    orm.insert(authUser).values([
      {
        id: OWNER_ID,
        name: 'owner',
        email: 'mine@example.com',
        emailVerified: false,
        createdAt: new Date(1),
        updatedAt: new Date(1),
      },
      {
        id: '1',
        name: 'other',
        email: 'theirs@example.com',
        emailVerified: false,
        createdAt: new Date(1),
        updatedAt: new Date(1),
      },
    ]),
    orm.insert(invitedEmails).values([
      { email: 'mine@example.com', invited_at: 1, invited_by: 'op' },
      { email: 'theirs@example.com', invited_at: 1, invited_by: 'op' },
    ]),
    orm.insert(authSession).values([
      {
        id: 'mine-1',
        token: 'mine-1',
        userId: OWNER_ID,
        createdAt: new Date(1),
        updatedAt: new Date(1),
        expiresAt: new Date(999999999999),
      },
      {
        id: 'mine-2',
        token: 'mine-2',
        userId: OWNER_ID,
        createdAt: new Date(1),
        updatedAt: new Date(1),
        expiresAt: new Date(999999999999),
      },
      {
        id: 'theirs-1',
        token: 'theirs-1',
        userId: '1',
        createdAt: new Date(1),
        updatedAt: new Date(1),
        expiresAt: new Date(999999999999),
      },
    ]),
  ])

  await markAccountDeleted(db, { ownerUserId: OWNER_ID, now: 1000 })

  expect(await liveDecks()).toEqual(['theirs'])
  expect(await isPublic(mine)).toBe(false)
  expect(await isPublic(theirs)).toBe(true)
  expect(await sessionsOf(OWNER_ID)).toBe(0)
  // A deck deleted earlier keeps its time, and its open upload is closed.
  const slides = await orm
    .select({ deleted_at: decks.deleted_at, state: deployments.state })
    .from(decks)
    .leftJoin(deployments, eq(deployments.id, open))
    .where(eq(decks.id, 'slides'))
    .get()
  expect(slides).toEqual({ deleted_at: 1, state: 'expired' })
  expect(await sessionsOf('1')).toBe(1)
  expect(
    await orm
      .select({ id: decks.id })
      .from(decks)
      .where(isNull(decks.deleted_at)),
  ).toEqual([{ id: 'theirs' }])

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
    new Request(`${TEST_ORIGIN}/api/slides`, { headers: { Cookie: cookie } }),
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
  expect(response.headers.get('location')).toBe('/goodbye')
  expect(
    response.headers
      .getSetCookie()
      .some((value) => /^__Host-slide_owner=;.*Max-Age=0/.test(value)),
  ).toBe(true)
  expect((await deckList(cookie)).status).toBe(401)

  const again = await signIn(env)
  expect(await (await deckList(again)).json()).toEqual({ decks: [] })
})

test('F28-AC77: given the owner leaves, when the form is sent, then the cookie is cleared and they are sent to /goodbye, and a wrong confirmation sends nobody there', async () => {
  const cookie = await signIn(env)
  const wrong = await deleteAccount(cookie, 'someone')
  expect(wrong.status).toBe(400)
  expect(wrong.headers.get('location')).toBeNull()
  const done = await deleteAccount(cookie, 'owner')
  expect(done.status).toBe(303)
  expect(done.headers.get('location')).toBe('/goodbye')
  expect(
    done.headers.getSetCookie().some((v) => /^__Host-slide_owner=;/.test(v)),
  ).toBe(true)
})
