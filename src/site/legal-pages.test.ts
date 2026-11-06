import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'
import { LEGAL_PAGE_POLICY } from './legal-pages'

const platform = await getPlatformProxy<Env>({ persist: false })
const env = testEnv(platform.env)
afterAll(() => platform.dispose())

const get = (path: string) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)

test.each([
  ['/terms', '利用規約'],
  ['/privacy', 'プライバシーポリシー'],
  ['/contact', 'お問い合わせ'],
])(
  'Given the placeholder %s, When it is requested, Then it says plainly that it is not final and is not indexed',
  async (path, title) => {
    const response = await get(path)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toBe(
      LEGAL_PAGE_POLICY,
    )
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    const page = await response.text()
    expect(page).toContain(`<h1>${title}（仮）</h1>`)
    expect(page).toContain('このページは仮のものです。')
    expect(page).toContain('約束や合意として扱いません')
  },
)

test.each(['/', '/uploads/x', '/decks', '/missing', '/terms'])(
  'Given a service page, When %s is requested, Then its footer links to every legal page',
  async (path) => {
    const page = await (await get(path)).text()
    for (const link of ['/terms', '/privacy', '/contact'])
      expect(page).toContain(`href="${link}"`)
  },
)
