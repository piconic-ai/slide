import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
let cookie = ''

beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  await resetTables(platform.env.DB)
  await seedPublic(platform.env.DB, 'talk', 1, 'Talk')
  cookie = await signIn(env)
})
afterAll(() => platform.dispose())

const get = (path: string, withSession = false) =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, {
      headers: withSession ? { Cookie: cookie } : {},
    }),
    env,
  )

const directive = (policy: string, name: string) =>
  policy
    .split('; ')
    .find((part) => part.startsWith(`${name} `))
    ?.split(' ')
    .slice(1)

// Every page that carries the router; the signed-in ones are marked.
const PAGES: [string, boolean][] = [
  ['/', false],
  ['/help', false],
  ['/terms', false],
  ['/missing', false],
  ['/@owner/talk', false],
  ['/@owner', false],
  ['/slides', true],
  ['/settings', true],
]

test.each(PAGES)(
  'F03-AC63: Given the page %s, When it is requested, Then its policy keeps default-src, script-src, base-uri and frame-ancestors, and allows connect-src to this origin',
  async (path, withSession) => {
    const response = await get(path, withSession)
    const policy = response.headers.get('Content-Security-Policy') ?? ''
    expect(directive(policy, 'default-src')).toEqual(["'none'"])
    expect(directive(policy, 'script-src')).toEqual(["'self'"])
    expect(directive(policy, 'connect-src')).toEqual(["'self'"])
    expect(directive(policy, 'base-uri')).toEqual(["'none'"])
    expect(directive(policy, 'frame-ancestors')).toEqual(["'none'"])
    // No script of its own, inline or from elsewhere, is allowed.
    expect(policy).not.toContain("script-src 'unsafe-inline'")
  },
)

test.each(PAGES)(
  'F03-AC63: Given the page %s, When it is requested, Then a page moved in from another page finds its frames, forms and pictures allowed, and no other directive is added',
  async (path, withSession) => {
    const response = await get(path, withSession)
    const policy = response.headers.get('Content-Security-Policy') ?? ''
    const names = policy.split('; ').map((part) => part.split(' ')[0])
    expect(names.sort()).toEqual(
      [
        'base-uri',
        'connect-src',
        'default-src',
        'form-action',
        'frame-ancestors',
        'frame-src',
        'img-src',
        'script-src',
        'style-src',
      ].sort(),
    )
    // The viewer also names the origin of the slides it shows.
    expect(directive(policy, 'frame-src')).toEqual(
      expect.arrayContaining(["'self'", 'https://*.content.example']),
    )
    expect(directive(policy, 'form-action')).toContain(
      'https://*.content.example',
    )
    expect(directive(policy, 'form-action')).toContain("'self'")
  },
)

test('F03-AC64: Given the viewer, When it is requested, Then the frame of the author’s slides keeps its sandbox, its referrer policy and its place on another origin', async () => {
  const page = await (await get('/@owner/talk')).text()
  const frame = /<iframe[^>]*id="deck"[^>]*>/.exec(page)?.[0] ?? ''
  expect(frame).toContain('sandbox="allow-scripts allow-same-origin"')
  expect(frame).toContain('referrerpolicy="no-referrer"')
  expect(frame).toMatch(/src="https:\/\/d-[0-9a-f-]+\.content\.example\//)
})

test('F03-AC63: Given a frame page that runs a script of its own with a nonce, When it is requested, Then its policy is not widened', async () => {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/@owner/talk`, {
      headers: { 'Sec-Fetch-Dest': 'iframe' },
    }),
    env,
  )
  const policy = response.headers.get('Content-Security-Policy') ?? ''
  expect(directive(policy, 'script-src')?.[0]).toMatch(/^'nonce-/)
  expect(directive(policy, 'frame-src')).toBeUndefined()
  expect(directive(policy, 'form-action')).toEqual(["'none'"])
})

test('F03-AC63: Given the page a site frames to embed slides, When it is requested, Then its policy is not widened, so it still names the one origin it frames and nothing else', async () => {
  const response = await get('/embed/@owner/talk')
  const policy = response.headers.get('Content-Security-Policy') ?? ''
  const frames = directive(policy, 'frame-src') ?? []
  expect(frames).toHaveLength(1)
  expect(frames[0]).toMatch(/^https:\/\/d-[0-9a-f-]+\.content\.example$/)
  expect(policy).not.toContain('https://*.content.example')
  expect(policy).not.toContain('github.com')
})
