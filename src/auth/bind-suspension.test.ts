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
import { drizzle } from 'drizzle-orm/d1'
import { decks, repositoryBindings } from '../db/schema'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import { applySuspensionCommand } from '../publication/suspension-store'
import {
  resetTables,
  signIn,
  testEnv,
  TEST_ORIGIN,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = testEnv(platform.env)
beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db))
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())
const cookie = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .find((v) => v.startsWith(`${name}=`))
    ?.split(';')[0] ?? ''
const request = (path: string, init: RequestInit = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, init), env)

const OWNER = '722500'
const suspend = () =>
  applySuspensionCommand(db, {
    userId: OWNER,
    command: { kind: 'suspend', reason: 'r', operator: 'op' },
    now: 100,
  })

/** Starts a connection for `talk` and returns what the callback needs. */
async function startConnection(session: string, repository: string) {
  const start = await request('/slides/connect', {
    method: 'POST',
    headers: {
      Cookie: session,
      Origin: TEST_ORIGIN,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      deck: 'talk',
      repository,
      branches: 'release',
    }),
  })
  expect(start.status).toBe(303)
  const state = new URL(start.headers.get('location')!).searchParams.get(
    'state',
  )!
  return {
    state,
    cookies: `${session}; ${cookie(start, '__Host-slide_oauth')}`,
  }
}

/** GitHub as the callback sees it; `beforeRepository` runs while it waits. */
function stubGitHub(
  repository: string,
  repositoryId: number,
  beforeRepository: () => Promise<unknown> = async () => {},
) {
  vi.stubGlobal('fetch', async (input: RequestInfo) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/access_token'))
      return Response.json({ access_token: 'gho_x' })
    if (url.endsWith('/user/emails')) return Response.json([])
    if (url.endsWith('/user'))
      return Response.json({ id: Number(OWNER), login: 'owner' })
    if (url.includes('/repos/')) {
      await beforeRepository()
      return Response.json({
        id: repositoryId,
        full_name: repository,
        owner: { id: 248307881 },
        permissions: { admin: true },
      })
    }
    return new Response(null, { status: 204 })
  })
}

const finish = (connection: { state: string; cookies: string }) =>
  request(`/auth/github/callback?code=c&state=${connection.state}`, {
    headers: { Cookie: connection.cookies },
  })

test('F17-AC32: Given a repository connection started before the owner was suspended, When GitHub returns to the callback after the suspension, Then nothing is connected', async () => {
  const session = await signIn(env)
  const connection = await startConnection(session, 'piconic-ai/slide')
  await suspend()
  stubGitHub('piconic-ai/slide', 1446590227)

  expect((await finish(connection)).status).toBe(403)
  expect(await orm.select().from(decks)).toEqual([])
  expect(await orm.select().from(repositoryBindings)).toEqual([])
})

test('F17-AC32: Given a callback waiting for GitHub to describe the repository, When the owner is suspended before GitHub answers, Then no deck and no connection are created', async () => {
  const session = await signIn(env)
  const connection = await startConnection(session, 'piconic-ai/slide')
  stubGitHub('piconic-ai/slide', 1446590227, suspend)

  expect((await finish(connection)).status).toBe(403)
  expect(await orm.select().from(decks)).toEqual([])
  expect(await orm.select().from(repositoryBindings)).toEqual([])
})

test('F17-AC32: Given a deck already connected and a callback waiting for GitHub, When the owner is suspended before GitHub answers, Then the existing connection is not replaced', async () => {
  const session = await signIn(env)
  stubGitHub('piconic-ai/slide', 1446590227)
  expect(
    (await finish(await startConnection(session, 'piconic-ai/slide'))).status,
  ).toBe(302)
  const before = await orm.select().from(repositoryBindings)
  expect(before).toHaveLength(1)

  const connection = await startConnection(session, 'piconic-ai/other')
  stubGitHub('piconic-ai/other', 99, suspend)

  expect((await finish(connection)).status).toBe(403)
  expect(await orm.select().from(repositoryBindings)).toEqual(before)
})
