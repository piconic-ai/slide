import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { contentSessions, deployments, previewLaunches } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { SESSION_HARD_SECONDS } from './lifetime'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
  await seedDeck(db, 'theirs', '1')
})
afterAll(() => platform.dispose())

const open = (cookie: string, deck: string, id: string, origin = TEST_ORIGIN) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}/decks/${deck}/deployments/${id}/preview`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: '',
    }),
    env,
  )
const launch = (id: string, token: string) =>
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
const tokenOf = async (response: Response) =>
  /name="token" value="([^"]+)"/.exec(await response.text())?.[1] ?? ''

test('Given a ready deployment, When the owner opens it, Then a page posts a one-time token to its own origin without putting it in the URL', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  const response = await open(cookie, 'talk', id)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(response.headers.get('Content-Security-Policy')).toContain(
    `form-action https://d-${id}.content.example`,
  )
  const body = await response.clone().text()
  expect(body).toContain(
    `action="https://d-${id}.content.example/_preview/launch"`,
  )
  const token = await tokenOf(response)
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(
    (
      await orm
        .select({ token_hash: previewLaunches.token_hash })
        .from(previewLaunches)
        .get()
    )?.token_hash,
  ).not.toBe(token)
})

test('Given a launch token, When consumed on its origin, Then a host-only session cookie is set and the token cannot be reused', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  const token = await tokenOf(await open(cookie, 'talk', id))
  const first = await launch(id, token)
  expect(first.status).toBe(303)
  expect(first.headers.get('Location')).toBe('/')
  expect(first.headers.get('Cache-Control')).toBe('private, no-store')
  const set = first.headers.getSetCookie()[0] ?? ''
  expect(set).toMatch(/^__Host-slide_preview=[A-Za-z0-9_-]{43};/)
  expect(set).toContain('Path=/')
  expect(set).toContain('Secure')
  expect(set).toContain('HttpOnly')
  expect(set).toContain('SameSite=Lax')
  expect(set).toContain(`Max-Age=${SESSION_HARD_SECONDS}`)
  expect(set).not.toMatch(/Domain=/i)
  expect((await launch(id, token)).status).toBe(403)
  expect(await orm.$count(contentSessions)).toBe(1)
})

test('Given one token, When two launches race, Then only one session opens', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  const token = await tokenOf(await open(cookie, 'talk', id))
  const statuses = (
    await Promise.all([launch(id, token), launch(id, token)])
  ).map((response) => response.status)
  expect(statuses.sort()).toEqual([303, 403])
  expect(await orm.$count(contentSessions)).toBe(1)
})

test('Given a token for A, When used on the origin of B, Then it is refused', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  const b = await seedDeployment(db, 'talk')
  const token = await tokenOf(await open(cookie, 'talk', a))
  expect((await launch(b, token)).status).toBe(403)
  expect((await launch(a, token)).status).toBe(303)
})

test('Given an expired token, When used, Then it is refused', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  const token = await tokenOf(await open(cookie, 'talk', id))
  await orm.update(previewLaunches).set({ created_at: 0, expires_at: 1 })
  expect((await launch(id, token)).status).toBe(403)
})

test.each(['uploading', 'failed', 'expired'] as const)(
  'Given a %s deployment, When the owner opens it, Then no token is issued',
  async (state) => {
    const cookie = await signIn(env)
    const id = await seedDeployment(db, 'talk', state)
    expect((await open(cookie, 'talk', id)).status).toBe(404)
    expect(await orm.$count(previewLaunches)).toBe(0)
  },
)

test('Given another owner’s deployment, When opened, Then no token is issued', async () => {
  const cookie = await signIn(env)
  const theirs = await seedDeployment(db, 'theirs')
  expect((await open(cookie, 'theirs', theirs)).status).toBe(404)
  // A deployment of another deck cannot be reached through one's own deck.
  expect((await open(cookie, 'talk', theirs)).status).toBe(404)
})

test('Given no owner session or a cross-site form, When opening, Then it is refused', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  expect((await open('', 'talk', id)).status).toBe(401)
  expect((await open(cookie, 'talk', id, 'https://evil.example')).status).toBe(
    403,
  )
})

test('Given a garbage token, When launched, Then it is refused without a session', async () => {
  const id = await seedDeployment(db, 'talk')
  expect((await launch(id, 'x')).status).toBe(403)
  expect(await orm.$count(contentSessions)).toBe(0)
})

test('Given no content origin, When opening, Then owner preview is unavailable', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/decks/talk/deployments/${id}/preview`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: TEST_ORIGIN },
    }),
    { ...env, CONTENT_ORIGIN: undefined } as unknown as Env,
  )
  expect(response.status).toBe(503)
})

test.each(['failed', 'expired'] as const)(
  'Given a token was issued, When the deployment becomes %s before launch, Then it is refused',
  async (state) => {
    const cookie = await signIn(env)
    const id = await seedDeployment(db, 'talk')
    const token = await tokenOf(await open(cookie, 'talk', id))
    await orm
      .update(deployments)
      .set({
        state,
        ready_at: null,
        failure_reason: state === 'failed' ? 'author_bytes_exceeded' : null,
      })
      .where(eq(deployments.id, id))
    const response = await launch(id, token)
    expect(response.status).toBe(403)
    expect(response.headers.getSetCookie()).toEqual([])
  },
)

test('Given a token was issued, When the allowed account changes before launch, Then it is refused', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  const token = await tokenOf(await open(cookie, 'talk', id))
  const response = await server.fetch(
    new Request(`https://d-${id}.content.example/_preview/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    }),
    { ...env, GITHUB_ACTOR_ID: '1' } as unknown as Env,
  )
  expect(response.status).toBe(403)
  expect(await orm.$count(contentSessions)).toBe(0)
})
