import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { profiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  OWNER_ID,
  resetTables,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { japaneseOutside } from '../site/test-japanese'
import { readProfile } from './store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = testEnv(platform.env)

beforeAll(() => applyMigrations(db))
beforeEach(() => resetTables(db))
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const get = (path: string, headers: Record<string, string> = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, { headers }), env)

const GITHUB = {
  name: 'Kenta Kobayashi',
  avatar_url: 'https://avatars.githubusercontent.com/u/722500?v=4',
  location: 'Tokyo',
  blog: 'kobaken.co',
}
const shown = async () => {
  const profile = await readProfile(db, OWNER_ID)
  if (!profile) return null
  const { syncedAt: _syncedAt, ...rest } = profile
  return rest
}

test('Given an author with a public GitHub profile and a Sponsors page, When they sign in, Then their profile is kept as GitHub gave it', async () => {
  const before = Math.floor(Date.now() / 1000)
  await signIn(env, 'owner', { profile: GITHUB, sponsors: true })
  expect(await shown()).toEqual({
    login: 'owner',
    name: 'Kenta Kobayashi',
    avatarUrl: 'https://avatars.githubusercontent.com/u/722500?v=4',
    location: 'Tokyo',
    website: 'https://kobaken.co/',
    hasSponsors: true,
  })
  expect((await readProfile(db, OWNER_ID))?.syncedAt).toBeGreaterThanOrEqual(
    before,
  )
})

test('Given a synced author who then emptied their GitHub profile and renamed themselves, When they sign in again, Then the emptied fields are gone and the login is the new one', async () => {
  await signIn(env, 'owner', { profile: GITHUB, sponsors: true })
  await signIn(env, 'renamed', { profile: { name: 'K' }, sponsors: false })
  expect(await shown()).toEqual({
    login: 'renamed',
    name: 'K',
    avatarUrl: null,
    location: null,
    website: null,
    hasSponsors: false,
  })
})

test('Given a synced author with a Sponsors page, When GitHub does not say on the next sign-in, Then sign-in succeeds and the last answer stays', async () => {
  await signIn(env, 'owner', { profile: GITHUB, sponsors: true })
  expect(await signIn(env, 'owner', { profile: GITHUB })).toMatch(
    /^__Host-slide_owner=/,
  )
  expect((await shown())?.hasSponsors).toBe(true)
})

test('Given a first sign-in where GitHub does not say about Sponsors, When the profile is read, Then it has no Sponsors link', async () => {
  await signIn(env, 'owner', { profile: GITHUB })
  expect((await shown())?.hasSponsors).toBe(false)
})

test('Given GitHub names an image elsewhere and a site that is not a web address, When the author signs in, Then neither is kept', async () => {
  await signIn(env, 'owner', {
    profile: {
      ...GITHUB,
      avatar_url: 'https://evil.example/a.png',
      blog: 'javascript:alert(1)',
    },
  })
  expect(await shown()).toMatchObject({ avatarUrl: null, website: null })
})

test('Given a sign-in that GitHub does not complete, When the callback is answered, Then no profile is kept', async () => {
  const response = await get('/auth/github/callback?code=c&state=unknown')
  expect(response.headers.getSetCookie().join()).not.toContain(
    '__Host-slide_owner=',
  )
  expect(await drizzle(db).select().from(profiles)).toEqual([])
})

test('Given a synced author, When a reader opens their profile, Then it shows who they are and how to support them, and allows the image from GitHub only', async () => {
  await signIn(env, 'owner', { profile: GITHUB, sponsors: true })
  const response = await get('/@owner')
  expect(response.status).toBe(200)
  const page = await response.text()
  expect(page).toContain('<h1>Kenta Kobayashi</h1>')
  expect(page).toContain('<p class="card-meta">@owner</p>')
  expect(page).toContain(
    'src="https://avatars.githubusercontent.com/u/722500?v=4"',
  )
  expect(page).toContain('Tokyo')
  expect(page).toMatch(
    /<a href="https:\/\/kobaken\.co\/" rel="nofollow noopener"\s*>kobaken\.co<\/a\s*>/,
  )
  expect(page).toMatch(
    /<a href="https:\/\/github\.com\/sponsors\/owner" rel="noopener"\s*>GitHub Sponsors で応援する<\/a\s*>/,
  )
  expect(response.headers.get('Content-Security-Policy')).toContain(
    'img-src https://avatars.githubusercontent.com',
  )
})

test('Given a synced author without a name, a site or a Sponsors page, When their profile is opened, Then the handle is the heading and nothing empty is shown', async () => {
  await signIn(env, 'owner', { profile: {}, sponsors: false })
  const page = await (await get('/@owner')).text()
  expect(page).toContain('<h1>@owner</h1>')
  expect(page).not.toContain('<img')
  expect(page).not.toContain('sponsors')
  expect(page).not.toContain('class="fact-name">Web サイト')
  expect(page).toContain('href="https://github.com/owner"')
})

test('Given a name written as markup, When the profile is opened, Then it is shown as text', async () => {
  await signIn(env, 'owner', {
    profile: { name: '<script>alert(1)</script>', location: '"><img src=x>' },
  })
  const page = await (await get('/@owner')).text()
  expect(page).not.toContain('<script>alert(1)</script>')
  expect(page).not.toContain('<img src=x>')
  expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
})

test('Given a reader of English, When a synced profile is opened, Then no Japanese is left', async () => {
  await signIn(env, 'owner', { profile: GITHUB, sponsors: true })
  const page = await (await get('/@owner?lang=en')).text()
  expect(page).toContain('Sponsor on GitHub')
  expect(japaneseOutside(page)).toEqual([])
})

test('Given a synced author, When they open the settings, Then they see what was synced and a way to sync again that comes back to the settings', async () => {
  const cookie = await signIn(env, 'owner', { profile: GITHUB, sponsors: true })
  const page = await (await get('/settings', { Cookie: cookie })).text()
  expect(page).toContain('<h1>Kenta Kobayashi</h1>')
  expect(page).toContain('最後の同期: ')
  expect(page).toContain(
    '<a href="/auth/github?to=settings">GitHub から同期し直す</a>',
  )
})

test.each([
  ['?to=settings', '/settings'],
  ['', '/decks'],
  ['?to=https://evil.example', '/decks'],
  ['?to=//evil.example', '/decks'],
])(
  'Given sign-in is started with %j, When GitHub sends the author back, Then they land on %j',
  async (query, landing) => {
    const start = await get(`/auth/github${query}`)
    const state = new URL(start.headers.get('location') ?? '').searchParams.get(
      'state',
    )
    vi.stubGlobal('fetch', async (input: RequestInfo) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.endsWith('/user/emails')) return Response.json([])
      if (url.endsWith('/access_token'))
        return Response.json({ access_token: 'gho_x' })
      if (url.endsWith('/user'))
        return Response.json({ id: Number(OWNER_ID), login: 'owner' })
      return new Response(null, { status: 204 })
    })
    const callback = await get(`/auth/github/callback?code=c&state=${state}`, {
      Cookie: start.headers.getSetCookie()[0]?.split(';')[0] ?? '',
    })
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe(landing)
  },
)

test('Given a synced author, When they leave the service, Then their profile is deleted with the account', async () => {
  const cookie = await signIn(env, 'owner', { profile: GITHUB, sponsors: true })
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/account/delete`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ confirm: 'owner' }),
    }),
    env,
  )
  expect(response.status).toBe(303)
  expect(await drizzle(db).select().from(profiles)).toEqual([])
})
