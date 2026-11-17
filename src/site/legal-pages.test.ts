import { afterAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { testEnv, TEST_ORIGIN } from '../publication/test-support'
import { CONTACT_ADDRESS, LEGAL_PAGE_POLICY } from './legal-pages'

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

test.each([
  ['/contact', 'お問い合わせは、次のメールアドレスへお送りください。'],
  ['/contact?lang=en', 'Please send inquiries to this email address.'],
])(
  'F17-AC24: Given %s, When it is requested, Then the address is shown as selectable text and no "not ready" wording remains',
  async (path, lead) => {
    const page = await (await get(path)).text()
    expect(page).toContain(lead)
    expect(page).toContain(`>${CONTACT_ADDRESS}</a>`)
    expect(page).toContain(`href="mailto:${CONTACT_ADDRESS}"`)
    expect(page).not.toContain('準備中')
    expect(page).not.toContain('not taking inquiries')
  },
)

test.each(['/terms', '/privacy'])(
  'F17-AC24: Given %s, When it is requested, Then it does not show the contact address',
  async (path) => {
    expect(await (await get(path)).text()).not.toContain(CONTACT_ADDRESS)
  },
)

test.each(['/', '/uploads/x', '/slides', '/missing', '/terms'])(
  'Given a service page, When %s is requested, Then its footer links to the help and every legal page',
  async (path) => {
    const page = await (await get(path)).text()
    for (const link of ['/help', '/terms', '/privacy', '/contact'])
      expect(page).toContain(`href="${link}"`)
  },
)

test('Given maintenance, When a legal page is requested, Then it is still served', async () => {
  const response = await server.fetch(new Request(`${TEST_ORIGIN}/terms`), {
    ...env,
    MAINTENANCE: 'on',
  } as Env)
  expect(response.status).toBe(200)
})
