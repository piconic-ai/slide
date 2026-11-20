import { and, eq } from 'drizzle-orm'
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
import { authSession, authUser } from '../db/auth-schema'
import {
  contentSessions,
  decks,
  previewLaunches,
  repositoryBindings,
} from '../db/schema'
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

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
/** Only the first author is registered, as in production today. */
const onlyFirst = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
/** Alice (the first author) and Bob (the invited one) are both registered. */
const both = withInvited(onlyFirst)
const settingOf = (value: string) =>
  ({ ...onlyFirst, AUTHOR_GITHUB_IDS: value }) as unknown as Env

let aliceDeployment: string
let bobDeployment: string
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'alice-talk', OWNER_ID)
  await seedDeck(db, 'bob-talk', INVITED_ID)
  aliceDeployment = await seedDeployment(db, 'alice-talk')
  bobDeployment = await seedDeployment(db, 'bob-talk')
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const alice = (env = both) => signIn(env, 'alice')
const bob = (env = both) => signIn(env, 'bob', { id: INVITED_ID })

const get = (path: string, cookie: string, env = both) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: cookie } }),
    env,
  )
const post = (
  path: string,
  cookie: string,
  body: Record<string, string> | { json: unknown } = {},
  env = both,
) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type':
          'json' in body
            ? 'application/json'
            : 'application/x-www-form-urlencoded',
      },
      body:
        'json' in body
          ? JSON.stringify(body.json)
          : new URLSearchParams(body).toString(),
    }),
    env,
  )
const open = (cookie: string, deck: string, id: string, env = both) =>
  post(`/slides/${deck}/deployments/${id}/preview`, cookie, {}, env)
const tokenOf = async (response: Response) =>
  /name="token" value="([^"]+)"/.exec(await response.text())?.[1] ?? ''
const launch = (id: string, token: string, env = both) =>
  server.fetch(
    new Request(`https://d-${id}.content.example/_preview/launch`, {
      method: 'POST',
      headers: {
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token }).toString(),
    }),
    env,
  )
const viewingCookie = (response: Response) =>
  response.headers.getSetCookie()[0]?.split(';')[0] ?? ''
const content = (id: string, cookie: string, env = both) =>
  server.fetch(
    new Request(`https://d-${id}.content.example/`, {
      headers: { Cookie: cookie },
    }),
    env,
  )
/** Opens a viewing session of the deployment for the signed-in person. */
async function viewingSession(cookie: string, deck: string, id: string) {
  const launched = await launch(id, await tokenOf(await open(cookie, deck, id)))
  expect(launched.status).toBe(303)
  return viewingCookie(launched)
}
const publish = (cookie: string, deck: string, id: string, env = both) =>
  post(
    `/api/slides/${deck}/publication`,
    cookie,
    { json: { action: 'publish', deploymentId: id, expectedRevision: 0 } },
    env,
  )
const deckRow = (id: string) =>
  orm.select().from(decks).where(eq(decks.id, id)).get()

test('F22-AC21: Given two registered people, When both sign in, Then each has their own session and sees only their own slides', async () => {
  const a = await alice()
  const b = await bob()

  expect(await (await get('/auth/owner', a)).json()).toEqual({
    userId: OWNER_ID,
    login: 'alice',
  })
  expect(await (await get('/auth/owner', b)).json()).toEqual({
    userId: INVITED_ID,
    login: 'bob',
  })
  await orm.insert(repositoryBindings).values(
    ['alice-talk', 'bob-talk'].map((deck, index) => ({
      deck_id: deck,
      repository_id: String(index + 1),
      repository_owner_id: '2',
      repository_full_name: `${deck}/slides`,
      allowed_refs: '["refs/heads/main"]',
      verified_by: index === 0 ? OWNER_ID : INVITED_ID,
      verified_at: 1,
    })),
  )
  const aliceList = await (await get('/slides', a)).text()
  expect(aliceList).toContain('alice-talk')
  expect(aliceList).not.toContain('bob-talk')
  const bobList = await (await get('/slides', b)).text()
  expect(bobList).toContain('bob-talk')
  expect(bobList).not.toContain('alice-talk')
  expect((await get('/slides/alice-talk', a)).status).toBe(200)
  expect((await get('/slides/bob-talk', b)).status).toBe(200)
})

test('F22-AC21: Given the invited author, When they publish and open their own slide, Then both work', async () => {
  const b = await bob()

  const published = await publish(b, 'bob-talk', bobDeployment)
  expect(published.status).toBe(200)
  expect((await deckRow('bob-talk'))?.public_deployment_id).toBe(bobDeployment)

  const launched = await launch(
    bobDeployment,
    await tokenOf(await open(b, 'bob-talk', bobDeployment)),
  )
  expect(launched.status).toBe(303)
  expect(await orm.$count(contentSessions)).toBe(1)
})

test.each([
  ['the management page', (c: string) => get('/slides/alice-talk', c)],
  ['the history', (c: string) => get('/api/slides/alice-talk/deployments', c)],
  [
    'the publication state',
    (c: string) => get('/api/slides/alice-talk/publication', c),
  ],
  ['publishing', (c: string) => publish(c, 'alice-talk', aliceDeployment)],
  [
    'publishing from the form',
    (c: string) =>
      post('/slides/alice-talk/publication', c, {
        action: 'publish',
        deploymentId: aliceDeployment,
        expectedRevision: '0',
      }),
  ],
  [
    'deleting',
    (c: string) =>
      post('/slides/alice-talk/delete', c, { confirm: 'alice-talk' }),
  ],
  [
    'opening an author-only view',
    (c: string) => open(c, 'alice-talk', aliceDeployment),
  ],
  [
    'opening an author-only view under their own slide',
    (c: string) => open(c, 'bob-talk', aliceDeployment),
  ],
])(
  'F22-AC23: Given another author’s slide, When the invited author tries %s, Then it looks like a slide that does not exist and nothing changes',
  async (_name, attempt) => {
    const before = await deckRow('alice-talk')
    const b = await bob()

    const foreign = await attempt(b)
    expect(foreign.status).toBe(404)
    expect(await deckRow('alice-talk')).toEqual(before)
    expect(await orm.$count(previewLaunches)).toBe(0)
  },
)

test('F22-AC23 and F22-AC25: Given another author’s slide, When the invited author connects a repository under the same slug, Then it is their own slide, and the other slide keeps its owner and gets no binding', async () => {
  await alice()
  const b = await bob()
  const start = await post('/slides/connect', b, {
    deck: 'alice-talk',
    repository: 'bob/slides',
    branches: 'main',
  })
  expect(start.status).toBe(303)
  const state = new URL(start.headers.get('location') ?? '').searchParams.get(
    'state',
  )
  const requested: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo) => {
    const url = String(input instanceof Request ? input.url : input)
    requested.push(url)
    if (url.endsWith('/user/emails')) return Response.json([])
    if (url.endsWith('/access_token'))
      return Response.json({ access_token: 'gho_x' })
    if (url.endsWith('/user'))
      return Response.json({ id: Number(INVITED_ID), login: 'bob' })
    if (url.includes('/repos/'))
      return Response.json({
        id: 9,
        full_name: 'bob/slides',
        owner: { id: Number(INVITED_ID) },
        permissions: { admin: true },
      })
    return new Response(null, { status: 204 })
  })
  const oauth = start.headers.getSetCookie()[0]?.split(';')[0] ?? ''

  const finished = await get(
    `/auth/github/callback?code=c&state=${state}`,
    `${b}; ${oauth}`,
  )

  expect(finished.status).toBe(302)
  expect(
    requested.filter((url) => new URL(url).pathname.endsWith('/followers')),
  ).toEqual([])
  expect((await deckRow('alice-talk'))?.owner_user_id).toBe(OWNER_ID)
  const bobs = await orm
    .select({ id: decks.id })
    .from(decks)
    .where(
      and(eq(decks.owner_user_id, INVITED_ID), eq(decks.slug, 'alice-talk')),
    )
  expect(bobs).toHaveLength(1)
  expect(bobs[0]?.id).not.toBe('alice-talk')
  expect(
    (await orm.select().from(repositoryBindings)).map((row) => row.deck_id),
  ).toEqual([bobs[0]?.id])
})

test('F22-AC23: Given the invited author’s launch token, When it is used on another author’s slide, Then it is refused', async () => {
  const b = await bob()
  const token = await tokenOf(await open(b, 'bob-talk', bobDeployment))

  expect((await launch(aliceDeployment, token)).status).toBe(403)
  expect(await orm.$count(contentSessions)).toBe(0)
})

test('F22-AC23: Given the invited author’s viewing session, When it is presented on another author’s slide, Then nothing is served', async () => {
  const b = await bob()
  const session = await viewingSession(b, 'bob-talk', bobDeployment)

  expect((await content(aliceDeployment, session)).status).toBe(401)
})

test('F22-AC23: Given a launch token whose slide now belongs to another author, When it is used, Then it is refused', async () => {
  const b = await bob()
  const token = await tokenOf(await open(b, 'bob-talk', bobDeployment))
  // Both people are still authors; only the slide's owner differs.
  await orm
    .update(decks)
    .set({ owner_user_id: OWNER_ID })
    .where(eq(decks.id, 'bob-talk'))

  expect((await launch(bobDeployment, token)).status).toBe(403)
  expect(await orm.$count(contentSessions)).toBe(0)
})

test('F22-AC23: Given a viewing session whose slide now belongs to another author, When it is presented, Then nothing is served', async () => {
  const b = await bob()
  const session = await viewingSession(b, 'bob-talk', bobDeployment)
  await orm
    .update(decks)
    .set({ owner_user_id: OWNER_ID })
    .where(eq(decks.id, 'bob-talk'))

  expect((await content(bobDeployment, session)).status).toBe(401)
})

test('F22-AC22: Given a person who is not registered, When they sign in with GitHub, Then no session or account is made and they land on a page saying it is invitation only', async () => {
  const start = await server.fetch(
    new Request(`${TEST_ORIGIN}/auth/github`),
    onlyFirst,
  )
  const state = new URL(start.headers.get('location') ?? '').searchParams.get(
    'state',
  )
  const requested: string[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo) => {
    const url = String(input instanceof Request ? input.url : input)
    requested.push(url)
    if (url.endsWith('/user/emails')) return Response.json([])
    if (url.endsWith('/access_token'))
      return Response.json({ access_token: 'gho_x' })
    if (url.endsWith('/user'))
      return Response.json({ id: Number(INVITED_ID), login: 'bob' })
    return new Response(null, { status: 204 })
  })

  const finished = await get(
    `/auth/github/callback?code=c&state=${state}`,
    start.headers.getSetCookie()[0]?.split(';')[0] ?? '',
    onlyFirst,
  )

  expect(finished.status).toBe(303)
  expect(finished.headers.get('location')).toBe('/auth/invitation-only')
  expect(
    finished.headers
      .getSetCookie()
      .some((cookie) => /^__Host-slide_owner=[^;]/.test(cookie)),
  ).toBe(false)
  expect(await orm.$count(authUser)).toBe(0)
  expect(await orm.$count(authSession)).toBe(0)
  // The token GitHub gave is revoked, as after every sign-in.
  expect(requested.at(-1)).toContain('/applications/Iv1.client/token')
  const page = await get('/auth/invitation-only', '', onlyFirst)
  expect(page.status).toBe(200)
  expect(await page.text()).toContain('招待制です')
})

test('F22-AC24: Given an author who was removed from the registration, When they use what they had, Then the session, the author-only views and a new sign-in all stop, and their published slide stays readable', async () => {
  const b = await bob()
  expect((await publish(b, 'bob-talk', bobDeployment)).status).toBe(200)
  const token = await tokenOf(await open(b, 'bob-talk', bobDeployment))
  const session = await viewingSession(b, 'bob-talk', bobDeployment)
  await orm
    .update(decks)
    .set({ public_deployment_id: null })
    .where(eq(decks.id, 'bob-talk'))

  // From here Bob is not registered.
  expect((await get('/auth/owner', b, onlyFirst)).status).toBe(401)
  expect((await get('/slides/bob-talk', b, onlyFirst)).status).toBe(401)
  expect((await get('/api/slides', b, onlyFirst)).status).toBe(401)
  expect((await publish(b, 'bob-talk', bobDeployment, onlyFirst)).status).toBe(
    401,
  )
  expect((await open(b, 'bob-talk', bobDeployment, onlyFirst)).status).toBe(401)
  expect((await launch(bobDeployment, token, onlyFirst)).status).toBe(403)
  expect((await content(bobDeployment, session, onlyFirst)).status).toBe(401)
  expect(await bob(onlyFirst)).toBe('')
  expect((await deckRow('bob-talk'))?.public_deployment_id).toBeNull()
})

test('F22-AC24: Given a removed author’s published slide, When a reader opens its share URL, Then it is still shown', async () => {
  const b = await bob()
  expect((await publish(b, 'bob-talk', bobDeployment)).status).toBe(200)

  const shared = await get('/@bob/bob-talk', '', onlyFirst)

  expect(shared.status).toBe(200)
  expect((await deckRow('bob-talk'))?.public_deployment_id).toBe(bobDeployment)
})

test.each([
  ['empty', ''],
  ['a trailing comma', `${OWNER_ID},`],
  ['the same ID twice', `${OWNER_ID},${OWNER_ID}`],
  ['a login name', `${OWNER_ID},bob`],
])(
  'Given a mistaken setting (%s), When anyone uses author features, Then nobody passes, not even a person it names',
  async (_name, value) => {
    const a = await alice()
    const token = await tokenOf(await open(a, 'alice-talk', aliceDeployment))
    const session = await viewingSession(a, 'alice-talk', aliceDeployment)
    const broken = settingOf(value)

    expect((await get('/auth/owner', a, broken)).status).toBe(401)
    expect((await launch(aliceDeployment, token, broken)).status).toBe(403)
    expect((await content(aliceDeployment, session, broken)).status).toBe(401)
    expect(await alice(broken)).toBe('')
  },
)
