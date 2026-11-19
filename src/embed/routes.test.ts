import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { suspensions } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { limitGroupOf } from '../site/rate-limit-policy'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let owner = ''
let revision = 0
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
  // Signing in records the handle "owner" from the stubbed GitHub login.
  owner = await signIn(env)
  revision = 0
})
afterAll(() => platform.dispose())

const open = (path: string, headers: Record<string, string> = {}, e = env) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`, { headers }), e)

async function act(body: Record<string, unknown>) {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides/talk/publication`, {
      method: 'POST',
      headers: {
        Cookie: owner,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, expectedRevision: revision }),
    }),
    env,
  )
  expect(response.status).toBe(200)
  revision++
}

/** Publishes a deployment of the deck under the given title. */
async function publish(title: string | null = 'Good talk') {
  const id = await seedDeployment(db, 'talk')
  await db
    .prepare('UPDATE deployments SET title = ? WHERE id = ?')
    .bind(title, id)
    .run()
  await act({ action: 'publish', deploymentId: id })
  return id
}

const frameTag = (page: string) => /<iframe\s[^>]*>/.exec(page)?.[0] ?? ''
const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null

/** The viewer's own 404, which no site may frame. */
async function expectUnavailable(response: Response) {
  expect(response.status).toBe(404)
  const body = await response.text()
  expect(body).toContain('この資料は公開されていません')
  expect(body).not.toContain('<iframe')
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex')
  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(response.headers.get('Content-Security-Policy')).toContain(
    "frame-ancestors 'none'",
  )
}

test('F25-AC1: Given public slides, When the page to frame is opened, Then it frames the deployment in the viewer’s sandbox, under a policy that lets any site frame it and names no source for requests or forms', async () => {
  const id = await publish()
  const response = await open('/embed/@owner/talk')
  expect(response.status).toBe(200)
  const page = await response.text()
  const origin = `https://d-${id}.content.example`
  const frame = frameTag(page)
  expect(attribute(frame, 'src')).toBe(`${origin}/`)
  // The same frame as the viewer's: no top navigation, popups, or forms.
  const viewer = frameTag(await (await open('/@owner/talk')).text())
  for (const name of ['sandbox', 'allow', 'referrerpolicy'])
    expect(attribute(frame, name)).toBe(attribute(viewer, name))
  expect(attribute(frame, 'sandbox')).toBe('allow-scripts allow-same-origin')
  expect(page.match(/<iframe\b/g)).toHaveLength(1)
  expect(response.headers.get('Content-Security-Policy')).toBe(
    `default-src 'none'; frame-src ${origin}; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors *`,
  )
  expect(response.headers.get('X-Frame-Options')).toBeNull()
  expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform')
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
  // The article is what a search lists, not the frame in it.
  expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  expect(limitGroupOf('/embed/@owner/talk')).toBe('viewer')
})

test('F25-AC1: Given public slides whose title holds markup, When the page to frame is opened, Then the line under the slides shows the title, the author and one link that opens the viewer in a new tab', async () => {
  await publish('<b>Bold</b> & "quoted"')
  const page = await (await open('/embed/@owner/talk')).text()
  expect(page).not.toContain('<b>Bold</b>')
  expect(page).toContain(
    '<span class="embed-title">&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quoted&quot;</span>',
  )
  expect(page).toMatch(/<span class="embed-author"\s*>@owner<\/span\s*>/)
  const links = page.match(/<a\s[^>]*>/g) ?? []
  expect(links).toHaveLength(1)
  expect(attribute(links[0] ?? '', 'href')).toBe(`${TEST_ORIGIN}/@owner/talk`)
  expect(attribute(links[0] ?? '', 'target')).toBe('_blank')
  expect(attribute(links[0] ?? '', 'rel')).toBe('noopener')
  expect(page).toMatch(/>Slide で開く<\/a\s*>/)
  const english = await (await open('/embed/@owner/talk?lang=en')).text()
  expect(english).toMatch(/>Open on Slide<\/a\s*>/)
})

test('F25-AC1: Given public slides without a title, When the page to frame is opened, Then the line names them as their URL does', async () => {
  await publish(null)
  const page = await (await open('/embed/@owner/talk')).text()
  expect(page).toContain('<span class="embed-title">talk</span>')
  expect(attribute(frameTag(page), 'title')).toBe('talk')
})

test('F25-AC3: Given slides that are a draft, then public, then stopped, When the page to frame is opened at each step, Then only the public step shows them', async () => {
  const id = await seedDeployment(db, 'talk')
  await expectUnavailable(await open('/embed/@owner/talk'))
  await act({ action: 'publish', deploymentId: id })
  expect((await open('/embed/@owner/talk')).status).toBe(200)
  await act({ action: 'pause' })
  await expectUnavailable(await open('/embed/@owner/talk'))
  await expectUnavailable(await open('/embed/@owner/talk/3'))
})

test('F25-AC3: Given public slides an operator hid, When the page to frame is opened, Then it is the 404 a share URL gives', async () => {
  await publish()
  await db
    .prepare(
      "UPDATE decks SET hidden_at = 1, hidden_reason = 'check', hidden_by = 'op' WHERE id = 'talk'",
    )
    .run()
  await expectUnavailable(await open('/embed/@owner/talk'))
})

test('F25-AC3: Given public slides of an author who is suspended, When the page to frame is opened, Then it is the 404 a share URL gives, and it shows again once the suspension ends', async () => {
  await publish()
  await drizzle(db).insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'fake sign-in page',
    suspended_at: 300,
    suspended_by: 'op@example.com',
  })
  await expectUnavailable(await open('/embed/@owner/talk'))
  await drizzle(db).delete(suspensions)
  expect((await open('/embed/@owner/talk')).status).toBe(200)
})

test.each([
  '/embed/@owner/missing',
  '/embed/@someone/talk',
  '/embed/@owner',
  '/embed/@owner/talk/3/4',
  '/embed/owner/talk',
  '/embed/',
  '/embed/%E0%A4%A/talk',
])(
  'F25-AC3: Given %s, When opened, Then it is the same 404 as slides that are not public',
  async (path) => {
    await publish()
    await expectUnavailable(await open(path))
  },
)

test('F25-AC3: Given content delivery is not configured, When the page to frame is opened, Then it is unavailable', async () => {
  await publish()
  const without = { ...env, CONTENT_ORIGIN: undefined } as unknown as Env
  await expectUnavailable(await open('/embed/@owner/talk', {}, without))
})

test('F25-AC5: Given a signed-in reader, the author and a visitor, When each opens the page to frame, Then all get the same page, with no way to follow, report or mute, no form and no request to the service', async () => {
  await publish()
  const invited = withInvited(env)
  const reader = await signIn(invited, 'reader', { id: INVITED_ID })
  const visitor = await open('/embed/@owner/talk', {}, invited)
  const page = await visitor.text()
  for (const cookie of [reader, owner]) {
    const response = await open(
      '/embed/@owner/talk',
      { Cookie: cookie },
      invited,
    )
    expect(await response.text()).toBe(page)
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform')
  }
  // The viewer of the same slides offers all three to this reader.
  const viewer = await (
    await open('/@owner/talk', { Cookie: reader }, invited)
  ).text()
  for (const action of ['/follows/new', '/reports/new', '/mutes/new']) {
    expect(viewer).toContain(action)
    expect(page).not.toContain(action)
  }
  for (const absent of [
    'data-follow-handle',
    'data-mute-handle',
    'フォロー',
    '通報',
    'ミュート',
    '<form',
    '<button',
    '/share.js',
    'site-header',
    '/api/',
  ])
    expect(page).not.toContain(absent)
  // The only script is the one that lets touches reach the slides.
  expect(page.match(/<script\b[^>]*>/g)).toEqual([
    '<script src="/embed.js" defer>',
  ])
  const policy = visitor.headers.get('Content-Security-Policy') ?? ''
  expect(policy).toContain("default-src 'none'")
  expect(policy).toContain("form-action 'none'")
  expect(policy).not.toContain('connect-src')
  expect(policy).not.toContain('img-src')
})

test('F25-AC10: Given public slides, When the page to frame is opened at /3, Then the slides start at #3 and the link opens the viewer on page 3', async () => {
  const id = await publish()
  const page = await (await open('/embed/@owner/talk/3')).text()
  expect(attribute(frameTag(page), 'src')).toBe(
    `https://d-${id}.content.example/#3`,
  )
  expect(page).toContain(`<a href="${TEST_ORIGIN}/@owner/talk/3"`)
  expect(page).toContain(
    `<link rel="canonical" href="${TEST_ORIGIN}/@owner/talk/3" />`,
  )
})

test.each(['0', '10000', '03', 'abc', '3/', '9999', '1'])(
  'F25-AC10: Given the page number spelled %s, When the page to frame is opened, Then it answers as the share URL with that number does',
  async (number) => {
    await publish()
    const [embed, share] = await Promise.all([
      open(`/embed/@owner/talk/${number}`),
      open(`/@owner/talk/${number}`),
    ])
    expect(embed.status).toBe(share.status)
    const moved = share.headers.get('Location')
    expect(embed.headers.get('Location')).toBe(moved && `/embed${moved}`)
  },
)

test('F25-AC10: Given the path spelled with capitals, an encoded @ and a trailing slash, When opened, Then it moves to the one spelling under /embed', async () => {
  await publish()
  const response = await open('/embed/%40Owner/Talk/')
  expect(response.status).toBe(301)
  expect(response.headers.get('Location')).toBe('/embed/@owner/talk')
})
