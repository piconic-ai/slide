import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { profileLinks, profiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { signIn, TEST_ORIGIN, testEnv } from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const database = platform.env.DB
const db = drizzle(database)
const env = testEnv(platform.env) as unknown as Env
let cookie = ''

beforeAll(async () => {
  await applyMigrations(database)
  cookie = await signIn(env, 'owner', { name: 'Old name' })
  expect(cookie).not.toBe('')
})
beforeEach(async () => {
  await db.delete(profileLinks)
  await db.update(profiles).set({
    name: 'Old name',
    bio: null,
    location: null,
    website: null,
  })
})
afterAll(() => platform.dispose())

const get = (path: string, signedIn = true) =>
  server.fetch(
    new Request(new URL(path, TEST_ORIGIN), {
      headers: signedIn ? { Cookie: cookie } : {},
    }),
    env,
  )

/** The page's own content: the style, header and footer say more. */
const mainOf = (page: string) =>
  page.slice(page.indexOf('<main'), page.indexOf('</main>'))

const save = (
  fields: [string, string][],
  headers: Record<string, string> = {},
) =>
  server.fetch(
    new Request(new URL('/settings/profile', TEST_ORIGIN), {
      method: 'POST',
      headers: { Cookie: cookie, Origin: TEST_ORIGIN, ...headers },
      body: new URLSearchParams(fields),
    }),
    env,
  )

const full: [string, string][] = [
  ['name', 'Kenta Demo'],
  ['bio', 'I write slides.'],
  ['location', 'Tokyo'],
  ['website', 'https://example.com/me'],
  ['link', 'https://bsky.app/profile/kenta'],
  ['link', ''],
  ['link', 'https://github.com/kenta'],
]

test('F28-AC35: Given a profile written in settings, When it is saved and the profile is opened, Then every field shows there', async () => {
  const saved = await save(full)
  expect(saved.status).toBe(303)
  expect(saved.headers.get('location')).toBe('/settings?saved=profile#profile')
  const page = await (await get('/@owner')).text()
  expect(page).toContain('<h1>Kenta Demo</h1>')
  expect(page).toContain('I write slides.')
  expect(page).toContain('Tokyo')
  expect(page).toContain('href="https://example.com/me"')
  expect(page).toContain('href="https://bsky.app/profile/kenta"')
  expect(page).toContain('href="https://github.com/kenta"')
})

test('F21-AC57: Given a saved display name, When the profile is opened, Then the name is its heading', async () => {
  await save([['name', 'Renamed']])
  expect(await (await get('/@owner')).text()).toContain('<h1>Renamed</h1>')
})

test('F21-AC58: Given a saved location, website and social links, When the profile is opened, Then each shows, in the order written, with links that leave the service marked', async () => {
  await save(full)
  const page = mainOf(await (await get('/@owner')).text())
  expect(page).toContain('Tokyo')
  const sns = [
    ...page.matchAll(/href="(https:\/\/(?:bsky\.app|github\.com)[^"]*)"/g),
  ]
  expect(sns.map(([, href]) => href)).toEqual([
    'https://bsky.app/profile/kenta',
    'https://github.com/kenta',
  ])
  expect(page).toMatch(
    /href="https:\/\/example\.com\/me"[^>]*rel="[^"]*nofollow[^"]*"/,
  )
})

test('F21-AC59: Given a saved bio with line breaks, When the profile is opened, Then the bio shows, breaks kept (provisional)', async () => {
  await save([
    ['name', 'N'],
    ['bio', 'line one\r\nline two'],
  ])
  expect(await (await get('/@owner')).text()).toContain(
    '<p class="profile-bio">line one\nline two</p>',
  )
})

test('F21-AC60: Given the location, website, links and bio were emptied, When the profile is opened, Then no such row, heading or empty paragraph is left', async () => {
  await save(full)
  await save([
    ['name', 'Kenta Demo'],
    ['link', ''],
    ['link', ''],
    ['link', ''],
  ])
  const page = mainOf(await (await get('/@owner')).text())
  expect(page).not.toContain('profile-bio')
  expect(page).not.toMatch(/fact-name/)
  expect(page).not.toContain('Tokyo')
})

test('F28-AC35: Given a profile that was saved, When settings are opened, Then the form holds the saved values', async () => {
  await save(full)
  const page = await (await get('/settings?saved=profile')).text()
  expect(page).toContain('value="Kenta Demo"')
  expect(page).toContain('I write slides.</textarea>')
  expect(page).toContain('value="https://example.com/me"')
  expect(page).toContain('value="https://bsky.app/profile/kenta"')
  expect(page).toContain('value="https://github.com/kenta"')
  expect(page).toContain('role="status"')
})

test('F28-AC36: Given an empty display name, When the form is saved, Then it is refused with the reason, what was typed is kept, and nothing is stored', async () => {
  const refused = await save([
    ['name', '   '],
    ['bio', 'typed bio'],
  ])
  expect(refused.status).toBe(400)
  const page = await refused.text()
  expect(page).toContain('表示名を入力してください')
  expect(page).toContain('typed bio</textarea>')
  const row = await db.select().from(profiles).get()
  expect(row?.name).toBe('Old name')
  expect(row?.bio).toBeNull()
})

test('F28-AC37: Given values over their limits, When the form is saved, Then each refusal names its limit and nothing is stored', async () => {
  const refused = await save([
    ['name', 'a'.repeat(51)],
    ['bio', 'a'.repeat(161)],
    ['location', 'a'.repeat(51)],
  ])
  expect(refused.status).toBe(400)
  const page = await refused.text()
  expect(page).toContain('50 文字までです。')
  expect(page).toContain('160 文字までです。')
  expect((await db.select().from(profiles).get())?.name).toBe('Old name')
  const exact = await save([
    ['name', 'a'.repeat(50)],
    ['bio', 'a'.repeat(160)],
    ['location', 'a'.repeat(50)],
  ])
  expect(exact.status).toBe(303)
})

test('F28-AC38: Given an http, javascript or schemeless address, When the form is saved, Then it is refused with the reason and nothing is stored', async () => {
  for (const address of [
    'http://example.com',
    'javascript:alert(1)',
    'example.com',
  ]) {
    const refused = await save([
      ['name', 'N'],
      ['website', address],
    ])
    expect(refused.status).toBe(400)
    expect(await refused.text()).toMatch(/https:\/\//)
  }
  expect(await db.select().from(profileLinks)).toEqual([])
  const link = await save([
    ['name', 'N'],
    ['link', 'http://x.com/a'],
  ])
  expect(link.status).toBe(400)
})

test('F28-AC39: Given four social links, When the form is saved, Then it is refused, and three are accepted', async () => {
  const four: [string, string][] = [
    ['name', 'N'],
    ...[1, 2, 3, 4].map((n): [string, string] => [
      'link',
      `https://e.com/${n}`,
    ]),
  ]
  const refused = await save(four)
  expect(refused.status).toBe(400)
  expect(await refused.text()).toContain('SNS のリンクは 3 つまでです。')
  expect(await db.select().from(profileLinks)).toEqual([])
  expect((await save(four.slice(0, 4))).status).toBe(303)
  expect(await db.select().from(profileLinks)).toHaveLength(3)
})

test('F28-AC40: Given a bio written as HTML, When the profile and settings are opened, Then it appears as characters and no element comes from it', async () => {
  const bio = '<img src=x onerror=alert(1)><script>alert(2)</script>'
  await save([
    ['name', 'N'],
    ['bio', bio],
  ])
  for (const path of ['/@owner', '/settings']) {
    const page = await (await get(path)).text()
    expect(page).not.toContain('<img src=x')
    expect(page).not.toContain('<script>alert(2)')
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;')
  }
})

test('F28-AC53: Given settings, When they are opened, Then nothing offers a GitHub sync or says when one last ran', async () => {
  const page = await (await get('/settings')).text()
  expect(page).not.toMatch(/GitHub から同期|最後に同期|Sync again|Last synced/i)
  expect(await (await get('/settings?lang=en')).text()).not.toMatch(/sync/i)
})

test('F28-AC54: Given settings, When the account part is read, Then the handle and email show, the handle noted as fixed and the email as visible only to the owner, in both languages', async () => {
  const ja = await (await get('/settings')).text()
  expect(ja).toContain('@owner')
  expect(ja).toContain('owner@mail.example')
  expect(ja).toContain('変えられません。')
  expect(ja).toContain('自分にだけ見えます。')
  const en = await (await get('/settings?lang=en')).text()
  expect(en).toContain('It cannot be changed.')
  expect(en).toContain('Only you can see it.')
})

test('F28-AC54: Given the owner’s email, When other pages are opened, Then none shows it (D-27)', async () => {
  for (const path of ['/@owner', '/', '/slides', '/@owner/following'])
    expect(await (await get(path)).text()).not.toContain('owner@mail.example')
  expect(await (await get('/@owner', false)).text()).not.toContain(
    'mail.example',
  )
})

test('Given no sign-in or a cross-site origin, When the profile is posted, Then nothing is saved', async () => {
  const anonymous = await server.fetch(
    new Request(new URL('/settings/profile', TEST_ORIGIN), {
      method: 'POST',
      headers: { Origin: TEST_ORIGIN },
      body: new URLSearchParams([['name', 'Hacked']]),
    }),
    env,
  )
  expect(anonymous.status).toBe(401)
  const crossSite = await save([['name', 'Hacked']], {
    Origin: 'https://evil.example',
  })
  expect(crossSite.status).toBe(403)
  expect((await db.select().from(profiles).get())?.name).toBe('Old name')
})

test('F28-AC35: Given a stored link that is not https (a row written by hand), When the profile is opened, Then it is not shown as a link', async () => {
  await db.insert(profileLinks).values([
    { user_id: '722500', position: 1, url: 'javascript:alert(1)' },
    { user_id: '722500', position: 2, url: 'https://ok.example/' },
  ])
  const page = await (await get('/@owner')).text()
  expect(page).not.toContain('javascript:')
  expect(page).toContain('href="https://ok.example/"')
})
