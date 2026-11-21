import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { signIn, TEST_ORIGIN, testEnv } from '../publication/test-support'

// The top page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

const get = (path: string, headers: Record<string, string> = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, { headers }), env)

test.each([
  ['a visitor who is not signed in', {}],
  ['a cookie that is not a session', { Cookie: '__Host-slide_owner=forged' }],
])(
  'F03-AC5: Given %s, When /start is opened, Then they are sent to the top page',
  async (_who, headers) => {
    const response = await get('/start', headers)
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/')
  },
)

test('F03-AC5: Given a signed-in author, When /start is opened, Then they are sent to the top page too', async () => {
  const cookie = await signIn(env)
  const response = await get('/start?lang=en', { Cookie: cookie })
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/')
})

test.each([
  ['a visitor who is not signed in', false],
  ['a signed-in author', true],
])(
  'F03-AC5: Given %s, When /slides/new is opened, Then they are sent to the list of slides',
  async (_who, signedIn) => {
    const headers = signedIn ? { Cookie: await signIn(env) } : undefined
    const response = await get('/slides/new', headers)
    expect(response.status).toBe(303)
    expect(response.headers.get('Location')).toBe('/slides')
  },
)

test('F03-AC5: Given the built top page, When it is opened, Then nothing on it leads to /start or /slides/new', async () => {
  const page = await (await get('/')).text()
  expect(page).not.toContain('/start')
  expect(page).not.toContain('/slides/new')
  expect(page).toContain('<noscript><a href="/login">ログイン</a></noscript>')
})

test('Given a visitor who is not signed in, When the session is asked, Then it says so and is not stored', async () => {
  const response = await get('/api/session')
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(await response.json()).toEqual({ signedIn: false })
})

test('Given a cookie that is not a session, When the session is asked, Then it is not signed in', async () => {
  const response = await get('/api/session', {
    Cookie: '__Host-slide_owner=forged',
  })
  expect(await response.json()).toEqual({ signedIn: false })
})

test('Given a signed-in author, When the session is asked, Then it names their handle and nothing else', async () => {
  const cookie = await signIn(env)
  const response = await get('/api/session', { Cookie: cookie })
  expect(await response.json()).toEqual({
    signedIn: true,
    login: 'owner',
    handle: 'owner',
    avatarUrl: null,
    unread: 0,
  })
})

test('Given a signed-in author with no picture of their own, When the session is asked, Then it names no picture, so the header shows their initial', async () => {
  const cookie = await signIn(env, 'owner')
  const response = await get('/api/session', { Cookie: cookie })
  expect(await response.json()).toMatchObject({ avatarUrl: null })
})

test('Given another site, When it asks the session, Then no CORS permission is given', async () => {
  const response = await get('/api/session', {
    Origin: 'https://elsewhere.example',
  })
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
})

test('Given a visitor who is not signed in, When the settings are opened, Then they are asked to sign in', async () => {
  const response = await get('/settings')
  expect(response.status).toBe(401)
  const page = await response.text()
  expect(page).toContain('href="/login"')
  expect(page).not.toContain('action="/account/delete"')
})

test('Given a signed-in author, When the settings are opened, Then the profile comes before the account, which ends with leaving the service', async () => {
  const cookie = await signIn(env)
  const response = await get('/settings', { Cookie: cookie })
  expect(response.status).toBe(200)
  const page = await response.text()
  const profile = page.indexOf('<h2>プロフィール</h2>')
  const account = page.indexOf('<h2>アカウント</h2>')
  const leave = page.indexOf('<h2>退会</h2>')
  expect(profile).toBeGreaterThan(-1)
  expect(account).toBeGreaterThan(profile)
  expect(leave).toBeGreaterThan(account)
  expect(page).toContain('<dd>@owner</dd>')
})

test('Given a signed-in author, When their decks are opened, Then signing out and leaving are not there', async () => {
  const cookie = await signIn(env)
  const page = await (await get('/slides', { Cookie: cookie })).text()
  expect(page).not.toContain('action="/auth/logout"')
  expect(page).not.toContain('action="/account/delete"')
})
