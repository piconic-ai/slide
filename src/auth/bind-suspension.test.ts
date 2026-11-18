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

test('F17-AC32: Given a repository connection started before the owner was suspended, When GitHub returns to the callback after the suspension, Then nothing is connected', async () => {
  const session = await signIn(env)
  const start = await request('/slides/connect', {
    method: 'POST',
    headers: {
      Cookie: session,
      Origin: TEST_ORIGIN,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      deck: 'talk',
      repository: 'piconic-ai/slide',
      branches: 'release',
    }),
  })
  expect(start.status).toBe(303)
  const state = new URL(start.headers.get('location')!).searchParams.get(
    'state',
  )!
  await applySuspensionCommand(db, {
    userId: '722500',
    command: { kind: 'suspend', reason: 'r', operator: 'op' },
    now: 100,
  })
  vi.stubGlobal('fetch', async (input: RequestInfo) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/access_token'))
      return Response.json({ access_token: 'gho_x' })
    if (url.endsWith('/user/emails')) return Response.json([])
    if (url.endsWith('/user'))
      return Response.json({ id: 722500, login: 'owner' })
    if (url.includes('/repos/'))
      return Response.json({
        id: 1446590227,
        full_name: 'piconic-ai/slide',
        owner: { id: 248307881 },
        permissions: { admin: true },
      })
    return new Response(null, { status: 204 })
  })
  const done = await request(`/auth/github/callback?code=c&state=${state}`, {
    headers: { Cookie: `${session}; ${cookie(start, '__Host-slide_oauth')}` },
  })
  expect(done.status).toBe(403)
  expect(await orm.select().from(decks)).toEqual([])
  expect(await orm.select().from(repositoryBindings)).toEqual([])
})
