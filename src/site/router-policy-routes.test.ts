import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
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
  ['/my/slides', true],
  ['/settings', true],
]

test.each(PAGES)(
  'F03-AC63: Given the page %s, When it is requested, Then its policy is the one it had: no origin of a deck is added to a frame, a form or a picture where it had none',
  async (path, withSession) => {
    const response = await get(path, withSession)
    const policy = response.headers.get('Content-Security-Policy') ?? ''
    expect(directive(policy, 'default-src')).toEqual(["'none'"])
    expect(directive(policy, 'script-src')).toEqual(["'self'"])
    expect(directive(policy, 'connect-src')).toEqual(["'self'"])
    expect(directive(policy, 'form-action')).not.toContain(
      'https://*.content.example',
    )
    expect(directive(policy, 'frame-src') ?? []).not.toContain(
      'https://*.content.example',
    )
    expect(directive(policy, 'frame-ancestors')).toEqual(["'none'"])
  },
)

test('F03-AC63: Given the pages with no form and no frame, When they are requested, Then they allow none', async () => {
  for (const path of ['/help/start', '/terms', '/missing']) {
    const policy =
      (await get(path)).headers.get('Content-Security-Policy') ?? ''
    expect(directive(policy, 'form-action')).toEqual(["'none'"])
    expect(directive(policy, 'frame-src')).toBeUndefined()
  }
})

test('F36-AC1: Given the help’s entrance, When it is requested, Then its search box may send to the service itself and to no other origin, and it frames nothing', async () => {
  const policy =
    (await get('/help')).headers.get('Content-Security-Policy') ?? ''
  expect(directive(policy, 'form-action')).toEqual(["'self'"])
  expect(directive(policy, 'frame-src')).toBeUndefined()
})

test('F03-AC63: Given the viewer, When it is requested, Then it frames the one deck origin and its own, and allows no form', async () => {
  const policy =
    (await get('/@owner/talk')).headers.get('Content-Security-Policy') ?? ''
  const frames = directive(policy, 'frame-src') ?? []
  expect(frames).toHaveLength(2)
  expect(frames[0]).toMatch(/^https:\/\/d-[0-9a-f-]+\.content\.example$/)
  expect(frames[1]).toBe("'self'")
  expect(directive(policy, 'form-action')).toEqual(["'none'"])
})

test('F03-AC64: Given the viewer, When it is requested, Then the frame of the author’s slides keeps its sandbox, its referrer policy and its place on another origin', async () => {
  const page = await (await get('/@owner/talk')).text()
  const frame = /<iframe[^>]*id="deck"[^>]*>/.exec(page)?.[0] ?? ''
  expect(frame).toContain('sandbox="allow-scripts allow-same-origin"')
  expect(frame).toContain('referrerpolicy="no-referrer"')
  expect(frame).toMatch(/src="https:\/\/d-[0-9a-f-]+\.content\.example\//)
})

test('F03-AC63: Given the page a site frames to embed slides, When it is requested, Then it names the one origin it frames and nothing else', async () => {
  const policy =
    (await get('/embed/@owner/talk')).headers.get('Content-Security-Policy') ??
    ''
  const frames = directive(policy, 'frame-src') ?? []
  expect(frames).toHaveLength(1)
  expect(frames[0]).toMatch(/^https:\/\/d-[0-9a-f-]+\.content\.example$/)
  expect(policy).not.toContain('https://*.content.example')
  expect(policy).not.toContain('github.com')
})

test('F44-AC27: Given the top page, When it is requested, Then it may frame the embed pages of its own origin, and no other page does, for a visitor or a signed-in author alike', async () => {
  for (const withSession of [false, true]) {
    const top = await get('/', withSession)
    expect(
      directive(top.headers.get('Content-Security-Policy') ?? '', 'frame-src'),
    ).toEqual([`${TEST_ORIGIN}/embed/`])
  }
  for (const [path, withSession] of PAGES.filter(([path]) => path !== '/')) {
    const policy =
      (await get(path, withSession)).headers.get('Content-Security-Policy') ??
      ''
    // The viewer frames its one deck; every other page frames nothing.
    if (path === '/@owner/talk') continue
    expect(directive(policy, 'frame-src'), path).toBeUndefined()
  }
  // The pages that share the home policy keep it as it was.
  const community = await get('/communities')
  expect(
    directive(
      community.headers.get('Content-Security-Policy') ?? '',
      'frame-src',
    ),
  ).toBeUndefined()
})
