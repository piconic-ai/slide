import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import { signIn, TEST_ORIGIN, testEnv } from '../publication/test-support'
import { japaneseOutside } from './test-japanese'

// The top page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

const get = (path: string, headers: Record<string, string> = {}) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, { headers }), env)

test('Given a visitor who is not signed in, When the start page is opened, Then it offers GitHub as the one way to sign up or sign in', async () => {
  const response = await get('/start')
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  const page = await response.text()
  expect(page).toContain('<h1>はじめる</h1>')
  expect(page).toContain(
    '<a class="cta" href="/auth/github">GitHub で登録・ログイン</a>',
  )
  expect(response.headers.get('Content-Security-Policy')).toContain(
    "connect-src 'self'",
  )
  expect(page).not.toContain('<a href="/decks">')
})

test('Given a reader of English, When the start page is opened, Then no Japanese is left', async () => {
  const page = await (await get('/start?lang=en')).text()
  expect(page).toContain('<h1>Get started</h1>')
  expect(page).toContain(
    'href="/auth/github">Sign up or sign in with GitHub</a>',
  )
  expect(japaneseOutside(page)).toEqual([])
})

test('Given a signed-in author, When the start page is opened, Then they are sent on to their decks', async () => {
  const cookie = await signIn(env)
  const response = await get('/start', { Cookie: cookie })
  expect(response.status).toBe(303)
  expect(response.headers.get('Location')).toBe('/decks')
})

test('Given a cookie that is not a session, When the start page is opened, Then the page is still shown', async () => {
  const response = await get('/start', {
    Cookie: '__Host-slide_owner=forged',
  })
  expect(response.status).toBe(200)
  expect(await response.text()).toContain('href="/auth/github"')
})

test('Given the built top page, When it is opened, Then both calls to action lead to the start page', async () => {
  const page = await (await get('/')).text()
  expect(page.match(/class="cta" href="\/start"/g)).toHaveLength(2)
  expect(page).not.toContain('href="/decks"')
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

test('Given a signed-in author, When the session is asked, Then it names them and nothing else', async () => {
  const cookie = await signIn(env, 'kobaken')
  const response = await get('/api/session', { Cookie: cookie })
  expect(await response.json()).toEqual({ signedIn: true, login: 'kobaken' })
})

test('Given another site, When it asks the session, Then no CORS permission is given', async () => {
  const response = await get('/api/session', {
    Origin: 'https://elsewhere.example',
  })
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
})
