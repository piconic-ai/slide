import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { app } from '../app/routes'
import { applyMigrations } from '../db/test-migrations'
import { signIn, TEST_ORIGIN, testEnv } from '../publication/test-support'
import { RESERVED_HANDLES } from '../auth/handle-rules'
import { drizzle } from 'drizzle-orm/d1'
import { authUser } from '../db/auth-schema'
import { accounts } from '../db/schema'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
beforeAll(() => applyMigrations(platform.env.DB))
afterAll(() => platform.dispose())

const get = (path: string, cookie = '') =>
  server.fetch(
    new Request(`${TEST_ORIGIN}${path}`, { headers: { Cookie: cookie } }),
    env,
  )

test('F28-AC83: Given nobody is signed in, When /goodbye is opened, Then it answers 200 with the thanks and the heading, in both languages', async () => {
  const ja = await get('/goodbye?lang=ja')
  expect(ja.status).toBe(200)
  const page = await ja.text()
  expect(page).toContain('<h1>退会しました</h1>')
  expect(page).toContain(
    'ご利用ありがとうございました。退会の手続きが完了しました。',
  )
  const en = await (await get('/goodbye?lang=en')).text()
  expect(en).toContain('<h1>Your account is deleted</h1>')
  expect(en).toContain('Thank you for using Slide. Your account is closed.')
})

test.each(['ja', 'en'])(
  'F28-AC84: Given the %s page, When it is read, Then it lists no deleted items and does not say what is left behind',
  async (lang) => {
    const page = await (await get(`/goodbye?lang=${lang}`)).text()
    const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'))
    expect(main).not.toContain('<ul>')
    expect(main).not.toContain('<li>')
  },
)

test('F28-AC80: Given the page, When it is read, Then the way back is a pill button to the top page and there is no sign-in link in the page', async () => {
  const page = await (await get('/goodbye')).text()
  const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'))
  expect(main).toContain('<a class="button-primary" href="/">トップへ戻る</a>')
  expect(main).not.toContain('/login')
})

test('F28-AC81: Given someone signed in, When they open /goodbye, Then nothing changes for them, and search engines are told not to list it', async () => {
  const cookie = await signIn(env, 'owner')
  const db = drizzle(platform.env.DB)
  const before = [await db.$count(authUser), await db.$count(accounts)]
  const response = await get('/goodbye', cookie)
  expect(response.status).toBe(200)
  expect(response.headers.get('x-robots-tag')).toContain('noindex')
  expect([await db.$count(authUser), await db.$count(accounts)]).toEqual(before)
  expect((await get('/auth/owner', cookie)).status).toBe(200)
  const post = await server.fetch(
    new Request(`${TEST_ORIGIN}/goodbye`, {
      method: 'POST',
      headers: { Cookie: cookie },
    }),
    env,
  )
  expect(post.status).toBe(404)
})

test('F28-AC82: Given the word goodbye, When it is chosen as a handle, Then it is reserved, and the app answers a route for it', () => {
  expect(RESERVED_HANDLES.has('goodbye')).toBe(true)
  expect(app.routes.some((route) => route.path === '/goodbye')).toBe(true)
})
