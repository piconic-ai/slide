import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { decks, suspensions, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { readPublication } from '../publication/store'
import { readSuspension } from '../publication/suspension-store'
import { applyOperatorCommand } from '../publication/takedown-store'
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

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = withInvited({
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env)

let alice = ''
let bob = ''
let aliceDeployment = ''
let bobDeployment = ''
let unknownProfile: { status: number; body: string }

const get = (path: string, cookie = '') =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), { headers: { Cookie: cookie } }),
    env,
  )
const responseOf = async (response: Response) => ({
  status: response.status,
  body: await response.text(),
})
const content = (deploymentId: string) =>
  get(`https://d-${deploymentId}.content.example/`)
const suspend = () =>
  db.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'fake sign-in page',
    suspended_at: 300,
    suspended_by: 'op@example.com',
  })
const release = () =>
  db.delete(suspensions).where(eq(suspensions.user_id, OWNER_ID))

async function storePage(deploymentId: string, body: string) {
  const key = `${deploymentId}/index/lease`
  await env.UPLOADS.put(key, body)
  await db.insert(uploadFiles).values({
    deployment_id: deploymentId,
    id: 'index',
    path: 'index.html',
    size: body.length,
    sha256: 'a'.repeat(64),
    media_type: 'text/html',
    object_key: key,
  })
}

beforeAll(() => applyMigrations(database))
beforeEach(async () => {
  await resetTables(database)
  // Compare the same URL so the language switcher's URL is identical too.
  unknownProfile = await responseOf(await get('/@alice'))
  alice = await signIn(env, 'alice')
  bob = await signIn(env, 'bob', { id: INVITED_ID })
  aliceDeployment = await seedPublic(
    database,
    'alice-talk',
    100,
    'Alice talk',
    OWNER_ID,
    'talk',
  )
  bobDeployment = await seedPublic(
    database,
    'bob-talk',
    200,
    'Bob talk',
    INVITED_ID,
    'talk',
  )
  await storePage(aliceDeployment, 'Alice content')
  await storePage(bobDeployment, 'Bob content')
})
afterAll(() => platform.dispose())

test('F17-AC15: Given two authors with public decks, When one owner is suspended, Then their share URL and content are refused like a hidden deck, their list entry and cover disappear, and the other deck is unchanged', async () => {
  expect((await get('/@alice/talk')).status).toBe(200)
  expect(await responseOf(await content(aliceDeployment))).toEqual({
    status: 200,
    body: 'Alice content',
  })
  expect((await get(`/covers/${aliceDeployment}.jpg`)).status).toBe(200)
  expect(await (await get('/api/public/slides')).text()).toContain('Alice talk')
  const bobShare = await responseOf(await get('/@bob/talk'))
  const bobContent = await responseOf(await content(bobDeployment))
  expect(bobShare.status).toBe(200)
  expect(bobContent).toEqual({ status: 200, body: 'Bob content' })

  await applyOperatorCommand(database, {
    deckId: 'alice-talk',
    command: { kind: 'hide', reason: 'fake sign-in page', operator: 'op' },
    now: 200,
  })
  const hiddenShare = await responseOf(await get('/@alice/talk'))
  const hiddenContent = await responseOf(await content(aliceDeployment))
  expect(hiddenShare.status).toBe(404)
  expect(hiddenContent.status).toBe(404)
  await applyOperatorCommand(database, {
    deckId: 'alice-talk',
    command: { kind: 'release' },
    now: 250,
  })
  await suspend()

  for (const cookie of ['', alice])
    expect(await responseOf(await get('/@alice/talk', cookie))).toEqual(
      hiddenShare,
    )
  expect(await responseOf(await content(aliceDeployment))).toEqual(
    hiddenContent,
  )
  const list = await get('/api/public/slides')
  expect(list.status).toBe(200)
  const body = await list.text()
  expect(body).not.toContain('Alice talk')
  expect(body).toContain('Bob talk')
  expect((await get(`/covers/${aliceDeployment}.jpg`)).status).toBe(404)
  expect(await responseOf(await get('/@bob/talk'))).toEqual(bobShare)
  expect(await responseOf(await content(bobDeployment))).toEqual(bobContent)
  expect((await get(`/covers/${bobDeployment}.jpg`)).status).toBe(200)
})

const publish = (
  cookie: string,
  deploymentId: string,
  expectedRevision: number,
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides/talk/publication`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'publish',
        deploymentId,
        expectedRevision,
      }),
    }),
    env,
  )

test.each(['draft', 'public'] as const)(
  'F17-AC15: Given a suspended owner with a %s deck, When they publish a ready deployment, Then the request is refused and the stored publication is unchanged',
  async (state) => {
    if (state === 'draft')
      await db
        .update(decks)
        .set({ public_deployment_id: null })
        .where(eq(decks.id, 'alice-talk'))
    const next = await seedDeployment(database, 'alice-talk')
    const before = await readPublication(database, 'alice-talk', OWNER_ID)
    if (!before) throw new Error('Missing publication')
    await suspend()

    const response = await publish(alice, next, before.revision)
    expect(response.ok).toBe(false)
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expect(await readPublication(database, 'alice-talk', OWNER_ID)).toEqual(
      before,
    )

    const otherNext = await seedDeployment(database, 'bob-talk')
    expect((await publish(bob, otherNext, 0)).status).toBe(200)
    expect(
      (await readPublication(database, 'bob-talk', INVITED_ID))?.publication,
    ).toEqual({ kind: 'public', deploymentId: otherNext })
  },
)

test('F17-AC15: Given a suspended owner with a public deck, When the suspension row is deleted, Then the deck is readable again with the same publication state', async () => {
  const before = await readPublication(database, 'alice-talk', OWNER_ID)
  expect(before?.publication).toEqual({
    kind: 'public',
    deploymentId: aliceDeployment,
  })
  expect(await readSuspension(database, OWNER_ID)).toBeNull()
  await suspend()
  expect(await readSuspension(database, OWNER_ID)).toEqual({
    reason: 'fake sign-in page',
    suspendedAt: 300,
    operator: 'op@example.com',
  })
  expect((await get('/@alice/talk')).status).toBe(404)
  expect(await readPublication(database, 'alice-talk', OWNER_ID)).toEqual(
    before,
  )
  await release()

  expect(await readSuspension(database, OWNER_ID)).toBeNull()
  expect((await get('/@alice/talk')).status).toBe(200)
  expect(await responseOf(await content(aliceDeployment))).toEqual({
    status: 200,
    body: 'Alice content',
  })
  expect((await get(`/covers/${aliceDeployment}.jpg`)).status).toBe(200)
  expect(await (await get('/api/public/slides')).text()).toContain('Alice talk')
  expect(await readPublication(database, 'alice-talk', OWNER_ID)).toEqual(
    before,
  )
})

test('F17-AC29: Given a suspended owner, When their profile is requested, Then its status and body match the same URL with an unknown handle', async () => {
  expect(unknownProfile.status).toBe(404)
  expect((await get('/@alice')).status).toBe(200)
  await suspend()

  for (const cookie of ['', alice])
    expect(await responseOf(await get('/@alice', cookie))).toEqual(
      unknownProfile,
    )
  expect((await get('/@bob')).status).toBe(200)
})
