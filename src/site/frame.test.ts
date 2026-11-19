import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import {
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

// The top page is public/index.html from `pnpm build`; CI builds before testing.
const platform = await getPlatformProxy<Env>({ persist: false })
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env
let cookie = ''
beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  // Signing in records the handle "owner" from the stubbed GitHub login.
  cookie = await signIn(env)
  await seedPublic(platform.env.DB, 'talk', 1, 'Talk')
})
afterAll(() => platform.dispose())

const count = (page: string, pattern: RegExp) =>
  (page.match(pattern) ?? []).length

const PAGES: readonly [name: string, path: string, signedIn: boolean][] = [
  ['the top page', '/', false],
  ['a profile', '/@owner', false],
  ['a missing profile', '/@nobody', false],
  ['the viewer of public slides', '/@owner/talk', false],
  ['the viewer, signed in', '/@owner/talk', true],
  ['a missing slide', '/@owner/none', false],
  ['the list of slides', '/slides', true],
  ['the list of slides, signed out', '/slides', false],
  ['one slide', '/slides/talk', true],
  ['a missing slide of the author', '/slides/none', true],
  ['the settings', '/settings', true],
  ['the help', '/help', false],
  ['the notifications', '/notifications', true],
  ['the terms', '/terms', false],
  ['the privacy policy', '/privacy', false],
  ['the contact page', '/contact', false],
  ['a page that does not exist', '/no-such-page', false],
  ['the invitation-only page', '/auth/invitation-only', false],
  ['the upload receipt', '/uploads/x', false],
]

test.each(PAGES)(
  'F03-AC6: Given %s, When it is opened, Then it has the shared header, one main and the shared footer, in that order',
  async (_name, path, signedIn) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        headers: signedIn ? { Cookie: cookie } : {},
      }),
      env,
    )
    const page = await response.text()
    expect(count(page, /<header class="site-header"/g)).toBe(1)
    expect(count(page, /<main[\s>]/g)).toBe(1)
    expect(count(page, /<\/main>/g)).toBe(1)
    expect(count(page, /<footer class="site-footer"/g)).toBe(1)
    const header = page.indexOf('<header class="site-header"')
    const main = page.search(/<main[\s>]/)
    const end = page.indexOf('</main>')
    const footer = page.indexOf('<footer class="site-footer"')
    expect(header).toBeLessThan(main)
    expect(main).toBeLessThan(end)
    expect(end).toBeLessThan(footer)
    // The script that fills the header's account area is loaded.
    expect(page).toMatch(/<script src="\/share\.js" defer(="")?><\/script>/)
  },
)

test('F03-AC6: Given the shared footer, When a page is opened in Japanese, Then it links the help, the terms and the privacy policy, and offers the other language', async () => {
  const page = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/help`), env)
  ).text()
  const footer = page.slice(page.indexOf('<footer class="site-footer"'))
  expect(footer).toContain('<a href="/help">ヘルプ</a>')
  expect(footer).toContain('<a href="/terms">規約</a>')
  expect(footer).toContain('<a href="/privacy">プライバシー</a>')
  expect(footer).toContain('href="/help?lang=en"')
})
