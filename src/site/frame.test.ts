import { afterAll, beforeAll, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
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
  // Signing in records the handle "owner".
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
  ['the list of slides', '/my/slides', true],
  ['the list of slides, signed out', '/my/slides', false],
  ['one slide', '/my/slides/talk', true],
  ['a missing slide of the author', '/my/slides/none', true],
  ['the settings', '/settings', true],
  ['the help', '/help', false],
  ['the notifications', '/notifications', true],
  ['the terms', '/terms', false],
  ['the privacy policy', '/privacy', false],
  ['the contact page', '/contact', false],
  ['a page that does not exist', '/no-such-page', false],
  ['the login page', '/login', false],
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

test('Given a page as written, When no script has run, Then the header link is empty and the way in is offered without scripts', async () => {
  const page = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/help`), env)
  ).text()
  expect(page).toMatch(/<span[^>]*data-account[^>]*><\/span>/)
  expect(page).toContain('<noscript><a href="/login">ログイン</a></noscript>')
})

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

test.each(PAGES)(
  'F03-AC92: Given %s, When it is opened, Then the shared footer links the GitHub repository, once, outside the main',
  async (_name, path, signedIn) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        headers: signedIn ? { Cookie: cookie } : {},
      }),
      env,
    )
    const page = await response.text()
    expect(
      count(page, /href="https:\/\/github\.com\/piconic-ai\/slide"/g),
    ).toBe(1)
    const footer = /<footer class="site-footer"[\s\S]*?<\/footer>/.exec(
      page,
    )?.[0]
    expect(footer).toContain('href="https://github.com/piconic-ai/slide"')
    expect(footer).not.toMatch(/<iframe\b/)
    expect(page.indexOf('</main>')).toBeLessThan(
      page.indexOf('href="https://github.com/piconic-ai/slide"'),
    )
  },
)

// The receipt page of an upload has its own markup and no router.
const MOVING_PAGES = PAGES.filter(([, path]) => !path.startsWith('/uploads/'))

test.each(MOVING_PAGES)(
  'F03-AC49: Given %s, When it is opened, Then one main is the region a move replaces, the page sits inside it, and the header and the footer are outside it',
  async (_name, path, signedIn) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        headers: signedIn ? { Cookie: cookie } : {},
      }),
      env,
    )
    const page = await response.text()
    expect(count(page, /bf-region/g)).toBe(1)
    expect(count(page, /<main bf-region="page">/g)).toBe(1)
    const region = page.slice(
      page.search(/<main bf-region/),
      page.indexOf('</main>'),
    )
    expect(region).toMatch(/<div class="page page-(wide|reading|narrow)/)
    expect(region).not.toContain('site-header')
    expect(region).not.toContain('site-footer')
    // The router runs after the script that draws the header.
    expect(page.indexOf('/share.js')).toBeLessThan(
      page.indexOf('/components/assets/router.js'),
    )
    expect(page).toMatch(
      /<script src="\/components\/assets\/router\.js" type="module"(="")?><\/script>/,
    )
  },
)

test('F03-AC49: Given the receipt page of an upload, When it is opened, Then it is not a region of the router, and a move to it is a page load', async () => {
  const page = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/uploads/x`), env)
  ).text()
  expect(page).not.toContain('bf-region')
})

test.each([
  ['the help', '/help', '.help-toc'],
  ['the contact page', '/contact', '.address'],
  ['the viewer', '/@owner/talk', '.viewer-notice'],
])(
  'F03-AC67: Given %s, When it is opened, Then its own styles are in the region a move replaces, and not in the head, which a move leaves as it is',
  async (_name, path, rule) => {
    const page = await (
      await server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)
    ).text()
    const head = page.slice(page.indexOf('<head>'), page.indexOf('</head>'))
    const region = page.slice(
      page.search(/<main bf-region/),
      page.indexOf('</main>'),
    )
    expect(head).not.toContain(rule)
    expect(region).toContain(`<style>`)
    expect(region).toContain(rule)
  },
)

test('F03-AC67: Given the shared styles, When a page is opened, Then they stay in the head, so a move does not bring them again', async () => {
  const page = await (
    await server.fetch(new Request(`${TEST_ORIGIN}/help`), env)
  ).text()
  const head = page.slice(page.indexOf('<head>'), page.indexOf('</head>'))
  expect(head).toContain('.site-header')
  const region = page.slice(
    page.search(/<main bf-region/),
    page.indexOf('</main>'),
  )
  expect(region).not.toContain('.site-header')
})
