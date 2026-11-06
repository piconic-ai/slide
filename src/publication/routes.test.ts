import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { z } from 'zod'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from './test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = testEnv(platform.env)

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
  await seedDeck(db, 'theirs', '1')
})
afterAll(() => platform.dispose())

const publicationSchema = z.object({
  mode: z.enum(['manual', 'repository']),
  publication: z.union([
    z.object({ kind: z.literal('draft') }),
    z.object({ kind: z.literal('public'), deploymentId: z.string() }),
    z.object({ kind: z.literal('paused'), resumeTo: z.string().nullable() }),
  ]),
  revision: z.number(),
})
const responseSchema = z.object({
  result: z.string().optional(),
  code: z.string().optional(),
  publication: publicationSchema,
})

const act = (cookie: string, body: unknown, deck = 'talk') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/api/decks/${deck}/publication`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    env,
  )
const read = (cookie: string, deck = 'talk') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/api/decks/${deck}/publication`, {
      headers: { Cookie: cookie },
    }),
    env,
  )
const parse = async (response: Response) =>
  responseSchema.parse(await response.json())

test('Given ready A and B, When A is published, B published, and A chosen again, Then each becomes public and the revision advances', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  const b = await seedDeployment(db, 'talk')
  const first = await act(cookie, {
    action: 'publish',
    deploymentId: a,
    expectedRevision: 0,
  })
  expect(first.status).toBe(200)
  expect((await parse(first)).publication).toMatchObject({
    publication: { kind: 'public', deploymentId: a },
    revision: 1,
  })
  await act(cookie, { action: 'publish', deploymentId: b, expectedRevision: 1 })
  const rollback = await parse(
    await act(cookie, {
      action: 'publish',
      deploymentId: a,
      expectedRevision: 2,
    }),
  )
  expect(rollback.publication).toMatchObject({
    publication: { kind: 'public', deploymentId: a },
    revision: 3,
  })
  expect((await parse(await read(cookie))).publication.revision).toBe(3)
})

test('Given the deck changed, When an older view publishes, Then it conflicts and the current public deployment stays', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  const b = await seedDeployment(db, 'talk')
  await act(cookie, { action: 'publish', deploymentId: a, expectedRevision: 0 })
  const stale = await act(cookie, {
    action: 'publish',
    deploymentId: b,
    expectedRevision: 0,
  })
  expect(stale.status).toBe(409)
  expect(await parse(stale)).toMatchObject({
    code: 'conflict',
    publication: {
      publication: { kind: 'public', deploymentId: a },
      revision: 1,
    },
  })
})

test('Given a pause and a publish built on the same view, When both arrive, Then the second conflicts and the pause holds', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  await act(cookie, { action: 'publish', deploymentId: a, expectedRevision: 0 })
  const b = await seedDeployment(db, 'talk')
  const [pause, publish] = [
    await act(cookie, { action: 'pause', expectedRevision: 1 }),
    await act(cookie, {
      action: 'publish',
      deploymentId: b,
      expectedRevision: 1,
    }),
  ]
  expect(pause.status).toBe(200)
  expect(publish.status).toBe(409)
  expect((await parse(await read(cookie))).publication.publication).toEqual({
    kind: 'paused',
    resumeTo: a,
  })
})

test('Given a paused deck, When resumed, Then the deployment public before the pause returns', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  await act(cookie, { action: 'publish', deploymentId: a, expectedRevision: 0 })
  await act(cookie, { action: 'pause', expectedRevision: 1 })
  const resumed = await parse(
    await act(cookie, { action: 'resume', expectedRevision: 2 }),
  )
  expect(resumed.publication.publication).toEqual({
    kind: 'public',
    deploymentId: a,
  })
  const again = await act(cookie, { action: 'resume', expectedRevision: 3 })
  expect(again.status).toBe(409)
  expect((await parse(again)).code).toBe('not_paused')
})

test('Given a manual deck, When the mode is set twice, Then it changes once and the repeat is unchanged', async () => {
  const cookie = await signIn(env)
  const set = await parse(
    await act(cookie, {
      action: 'set_mode',
      mode: 'repository',
      expectedRevision: 0,
    }),
  )
  expect(set).toMatchObject({
    result: 'applied',
    publication: { mode: 'repository', revision: 1 },
  })
  const repeat = await parse(
    await act(cookie, {
      action: 'set_mode',
      mode: 'repository',
      expectedRevision: 1,
    }),
  )
  expect(repeat).toMatchObject({
    result: 'unchanged',
    publication: { revision: 1 },
  })
})

test.each(['uploading', 'failed', 'expired'] as const)(
  'Given a %s deployment, When published, Then it is refused and the deck stays a draft',
  async (state) => {
    const cookie = await signIn(env)
    const id = await seedDeployment(db, 'talk', state)
    const response = await act(cookie, {
      action: 'publish',
      deploymentId: id,
      expectedRevision: 0,
    })
    expect(response.status).toBe(422)
    expect((await parse(response)).publication).toMatchObject({
      publication: { kind: 'draft' },
      revision: 0,
    })
  },
)

test('Given another deck’s ready deployment, When published here, Then it is refused', async () => {
  const cookie = await signIn(env)
  const other = await seedDeployment(db, 'theirs')
  const response = await act(cookie, {
    action: 'publish',
    deploymentId: other,
    expectedRevision: 0,
  })
  expect(response.status).toBe(422)
})

test('Given another owner’s deck, When read or changed, Then it looks unknown', async () => {
  const cookie = await signIn(env)
  expect((await read(cookie, 'theirs')).status).toBe(404)
  expect(
    (await act(cookie, { action: 'pause', expectedRevision: 0 }, 'theirs'))
      .status,
  ).toBe(404)
  const revision = await db
    .prepare("SELECT revision FROM decks WHERE id = 'theirs'")
    .first('revision')
  expect(revision).toBe(0)
})

test.each([
  ['an unknown action', { action: 'delete', expectedRevision: 0 }],
  ['a missing revision', { action: 'pause' }],
  ['a negative revision', { action: 'pause', expectedRevision: -1 }],
  [
    'a deployment that is not an ID',
    { action: 'publish', deploymentId: 'x', expectedRevision: 0 },
  ],
  ['an extra field', { action: 'pause', expectedRevision: 0, force: true }],
])(
  'Given %s, When requested, Then it is rejected as invalid',
  async (_, body) => {
    const cookie = await signIn(env)
    expect((await act(cookie, body)).status).toBe(400)
  },
)

test('Given no owner session, When publication is read or changed, Then sign-in is required', async () => {
  expect((await read('')).status).toBe(401)
  expect((await act('', { action: 'pause', expectedRevision: 0 })).status).toBe(
    401,
  )
})

test('Given a cross-site form post, When it tries to pause, Then CSRF protection refuses it', async () => {
  const cookie = await signIn(env)
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/decks/talk/publication`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://evil.example',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'action=pause&expectedRevision=0',
    }),
    env,
  )
  expect(response.status).toBe(403)
  expect((await parse(await read(cookie))).publication.revision).toBe(0)
})

test('Given another tab published B, When the author pauses from the view of A, Then B is stopped', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  const b = await seedDeployment(db, 'talk')
  await act(cookie, { action: 'publish', deploymentId: a, expectedRevision: 0 })
  await act(cookie, { action: 'publish', deploymentId: b, expectedRevision: 1 })
  const pause = await act(cookie, { action: 'pause', expectedRevision: 1 })
  expect(pause.status).toBe(200)
  expect((await parse(pause)).publication.publication).toEqual({
    kind: 'paused',
    resumeTo: b,
  })
})
