import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { contentSessions, deployments, previewLaunches } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  keepInvited,
  postFrameLaunch,
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  testEnv,
  viewerLaunch,
} from '../publication/test-support'

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

const ask = (cookie: string, id: string) =>
  viewerLaunch(env, cookie, `/@owner/talk?v=${id}`)
const launch = (action: string, token: string) =>
  postFrameLaunch(env, action, token)

test('F02-AC33: Given a launch token, When the viewer’s frame posts it, Then a short partitioned cookie is set, the frame is told to move, and the token cannot be reused', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  const { action, token } = await ask(cookie, id)
  const first = await launch(action, token)
  expect(first.status).toBe(200)
  expect(first.headers.get('Cache-Control')).toContain('no-store')
  const set = first.headers.getSetCookie()[0] ?? ''
  expect(set).toMatch(/^__Host-slide_preview=[A-Za-z0-9_-]{43};/)
  for (const part of [
    'Path=/',
    'Secure',
    'HttpOnly',
    'SameSite=None',
    'Partitioned',
    'Max-Age=300',
  ])
    expect(set).toContain(part)
  expect(set).not.toMatch(/Domain=/i)
  expect((await launch(action, token)).status).toBe(403)
  expect(await orm.$count(contentSessions)).toBe(1)
})

test('F02-AC18: Given the launch is posted other than into a frame, When it arrives, Then it opens nothing: there is no top-level way in', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  const { action, token } = await ask(cookie, id)
  const response = await server.fetch(
    new Request(action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    }),
    env,
  )
  expect(response.status).toBe(404)
  expect(response.headers.getSetCookie()).toEqual([])
  expect(await orm.$count(contentSessions)).toBe(0)
})

test('F02-AC18: Given the old way in, When its route is asked for, Then nothing is offered: GET is 404, POST is refused', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  const url = `https://slide.example/slides/talk/deployments/${id}/preview`
  const got = await server.fetch(
    new Request(url, { headers: { Cookie: cookie } }),
    env,
  )
  expect(got.status).toBe(404)
  const posted = await server.fetch(
    new Request(url, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://slide.example',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }),
    env,
  )
  expect(posted.status).toBeGreaterThanOrEqual(400)
  expect(await posted.text()).not.toContain('name="token"')
  expect(await orm.$count(previewLaunches)).toBe(0)
})

test('F02-AC25: Given one token, When two launches race, Then only one session opens', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  const { action, token } = await ask(cookie, id)
  const statuses = (
    await Promise.all([launch(action, token), launch(action, token)])
  ).map((response) => response.status)
  expect(statuses.sort()).toEqual([200, 403])
  expect(await orm.$count(contentSessions)).toBe(1)
})

test('F02-AC34: Given a token for A, When used on the origin of B, Then it is refused', async () => {
  const cookie = await signIn(env)
  const a = await seedDeployment(db, 'talk')
  const b = await seedDeployment(db, 'talk')
  const { action, token } = await ask(cookie, a)
  const wrong = action.replace(`d-${a}`, `d-${b}`)
  expect((await launch(wrong, token)).status).toBe(403)
  expect((await launch(action, token)).status).toBe(200)
})

test('F02-AC33: Given an expired token, When used, Then it is refused', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  const { action, token } = await ask(cookie, id)
  await orm.update(previewLaunches).set({ created_at: 0, expires_at: 1 })
  expect((await launch(action, token)).status).toBe(403)
})

test.each(['uploading', 'failed', 'expired'] as const)(
  'F02-AC41: Given a %s deployment, When the author asks for it, Then it is 404 and no token is issued',
  async (state) => {
    const cookie = await signIn(env)
    await seedDeployment(db, 'talk')
    const id = await seedDeployment(db, 'talk', state)
    expect((await ask(cookie, id)).status).toBe(404)
    expect(await orm.$count(previewLaunches)).toBe(0)
  },
)

test('F02-AC19: Given another author’s deployment, When asked for through one’s own slides, Then no token is issued', async () => {
  const cookie = await signIn(env)
  await seedDeployment(db, 'talk')
  const theirs = await seedDeployment(db, 'theirs')
  expect((await ask(cookie, theirs)).status).toBe(404)
  expect(await orm.$count(previewLaunches)).toBe(0)
})

test('F02-AC19: Given no sign-in, When the viewer of a draft is asked for, Then it is 404', async () => {
  const id = await seedDeployment(db, 'talk')
  expect((await ask('', id)).status).toBe(404)
})

test('F02-AC25: Given a garbage token, When launched, Then it is refused without a session', async () => {
  const id = await seedDeployment(db, 'talk')
  const response = await launch(
    `https://d-${id}.content.example/_preview/launch`,
    'x',
  )
  expect(response.status).toBe(403)
  expect(await orm.$count(contentSessions)).toBe(0)
})

test.each(['failed', 'expired'] as const)(
  'F02-AC26: Given a token was issued, When the deployment becomes %s before launch, Then it is refused',
  async (state) => {
    const cookie = await signIn(env)
    const id = await seedDeployment(db, 'talk')
    const { action, token } = await ask(cookie, id)
    await orm
      .update(deployments)
      .set({
        state,
        ready_at: null,
        failure_reason: state === 'failed' ? 'author_bytes_exceeded' : null,
      })
      .where(eq(deployments.id, id))
    const response = await launch(action, token)
    expect(response.status).toBe(403)
    expect(response.headers.getSetCookie()).toEqual([])
  },
)

test('F02-AC28: Given a token was issued, When the allowed account changes before launch, Then it is refused', async () => {
  const cookie = await signIn(env)
  const id = await seedDeployment(db, 'talk')
  const { action, token } = await ask(cookie, id)
  await keepInvited(db, ['1'])
  const response = await server.fetch(
    new Request(action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Sec-Fetch-Dest': 'iframe',
      },
      body: new URLSearchParams({ token }).toString(),
    }),
    env,
  )
  expect(response.status).toBe(403)
  expect(await orm.$count(contentSessions)).toBe(0)
})
