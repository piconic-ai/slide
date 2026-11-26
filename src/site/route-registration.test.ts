import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import {
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env) as unknown as Env
let owner = ''

beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  // Signing in records the handle "owner".
  owner = await signIn(env)
  await seedPublic(platform.env.DB, 'talk', 1, 'A talk')
})
afterAll(() => platform.dispose())

const open = (path: string, method = 'GET') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      method,
      headers: { Cookie: owner },
    }),
    env,
  )

// Every route below is answered by its own handler. A route that an earlier
// registration shadowed would fall to the generic HTML 404 instead.
test.each([
  ['GET', '/@owner/following', 200, 'text/html'],
  ['GET', '/@owner/followers', 200, 'text/html'],
  ['GET', '/@owner/talk', 200, 'text/html'],
  ['GET', '/embed/@owner/talk', 200, 'text/html'],
  ['GET', '/oembed', 404, 'application/json'],
  ['POST', '/mcp', 401, 'application/json'],
  ['GET', '/.well-known/oauth-authorization-server', 200, 'application/json'],
  ['GET', '/.well-known/oauth-protected-resource', 200, 'application/json'],
  ['GET', '/.well-known/oauth-protected-resource/mcp', 200, 'application/json'],
  ['POST', '/oauth/register', 400, 'application/json'],
  ['POST', '/oauth/token', 400, 'application/json'],
  ['GET', '/my/slides', 200, 'text/html'],
  ['GET', '/my/slides/talk', 200, 'text/html'],
] as const)(
  'Given the whole app, When %s %s is requested, Then its own handler answers with %i %s',
  async (method, path, status, type) => {
    const response = await open(path, method)
    expect(response.status).toBe(status)
    expect(response.headers.get('content-type')).toContain(type)
  },
)

test.each([
  ['/my/slides/new', '/my/slides'],
  ['/start', '/'],
])(
  'Given a removed entrance, When %s is requested, Then it redirects to %s',
  async (path, location) => {
    const response = await open(path)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(location)
  },
)

test.each(['/my/slides/talk/reactions'])(
  'Given a removed route, When %s is requested, Then it is not found',
  async (path) => {
    expect((await open(path)).status).toBe(404)
  },
)

// The owner pages moved under /my (2026-11-26) with no redirect left behind.
test.each([
  ['GET', '/slides'],
  ['GET', '/slides/'],
  ['GET', '/slides/new'],
  ['GET', '/slides/talk'],
  ['GET', '/slides/talk/article'],
  ['POST', '/slides/talk/publication'],
  ['POST', '/slides/talk/links'],
  ['POST', '/slides/talk/article'],
  ['POST', '/slides/talk/delete'],
])(
  'F03-AC157: Given a signed-in author, When %s %s, the old address of an owner page, is requested, Then it is not found and sends nowhere else',
  async (method, path) => {
    const response = await open(path, method)
    expect(response.status).toBe(404)
    expect(response.headers.get('location')).toBeNull()
  },
)

test.each(['/communities/manage', '/communities/manage/'])(
  'F30-AC64: Given a signed-in person, When %s, the old address of the communities they run, is requested, Then it is not found and sends nowhere else',
  async (path) => {
    const response = await open(path)
    expect(response.status).toBe(404)
    expect(response.headers.get('location')).toBeNull()
  },
)

test.each([
  ['/my/communities', 200],
  ['/communities/new', 200],
] as const)(
  'F30-AC64: Given a signed-in person, When %s is requested, Then its page answers %i where it is now',
  async (path, status) => {
    expect((await open(path)).status).toBe(status)
  },
)

test('Given the whole app, When /@owner/following and /@owner/talk are compared, Then they are different pages', async () => {
  const following = await (await open('/@owner/following')).text()
  const talk = await (await open('/@owner/talk')).text()
  expect(following).not.toBe(talk)
})
