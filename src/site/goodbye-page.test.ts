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

test('F28-AC78: Given nobody is signed in, When /goodbye is opened, Then it answers 200 with the thanks and the heading, in both languages', async () => {
  const ja = await get('/goodbye?lang=ja')
  expect(ja.status).toBe(200)
  const page = await ja.text()
  expect(page).toContain('<h1>退会しました</h1>')
  expect(page).toContain(
    'ご利用ありがとうございました。次のものを削除しました。',
  )
  const en = await (await get('/goodbye?lang=en')).text()
  expect(en).toContain('<h1>Your account is deleted</h1>')
  expect(en).toContain('Thank you for using Slide. We deleted the following.')
})

test.each([
  [
    'ja',
    [
      'スライド',
      '記事',
      '関連リンク',
      '共有 URL',
      'フォロー、ミュート、お知らせの記録',
      'プロフィール',
      '顔写真',
      'メールアドレス',
    ],
  ],
  [
    'en',
    [
      'Slides',
      'Articles',
      'Related links',
      'Share URLs',
      'Your follows, mutes and notifications',
      'Your profile',
      'Your picture',
      'Your email address',
    ],
  ],
])(
  'F28-AC79: Given the %s page, When it is read, Then it lists exactly what was deleted, in order, and nothing vague',
  async (lang, items) => {
    const page = await (await get(`/goodbye?lang=${lang}`)).text()
    const list = /<main[\s\S]*?<ul>([\s\S]*?)<\/ul>/.exec(page)?.[1] ?? ''
    expect([...list.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1])).toEqual(
      items,
    )
    expect(page).not.toContain('など')
    expect(page).not.toMatch(/\betc\b/)
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
