import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { deployments } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedPublic,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

let talk = ''

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  // Signing in records the handle "owner" from the stubbed GitHub login.
  await signIn(env)
  talk = await seedPublic(db, 'talk', 1, 'Talk')
})
afterAll(() => platform.dispose())

const view = (path: string) =>
  server.fetch(new Request(`${TEST_ORIGIN}${path}`), env)

test('Given a page in the share URL, When opened, Then the deck starts at that page and the page’s URL is the one to share', async () => {
  const page = await (await view('/@owner/talk/6')).text()

  expect(page).toMatch(
    /<iframe\s[^>]*src="https:\/\/d-[^"]+\.content\.example\/#6"/,
  )
  expect(page).toContain('value="https://slide.example/@owner/talk/6"')
})

test('Given a public deck that states a description, When opened, Then the description shows under the title and is offered to services that preview links', async () => {
  await orm
    .update(deployments)
    .set({ description: 'Six "techniques" <b>' })
    .where(eq(deployments.id, talk))

  const page = await (await view('/@owner/talk/6')).text()

  expect(page).toContain(
    '<p class="viewer-description">Six &quot;techniques&quot; &lt;b&gt;</p>',
  )
  expect(page).toContain(
    '<meta name="description" content="Six &quot;techniques&quot; &lt;b&gt;" />',
  )
  expect(page).toContain(
    '<meta property="og:description" content="Six &quot;techniques&quot; &lt;b&gt;" />',
  )
  expect(page).toContain('<meta property="og:title" content="Talk" />')
  expect(page).toContain(
    '<meta property="og:url" content="https://slide.example/@owner/talk/6" />',
  )
})

test('Given a public deck that states no description, When opened, Then the preview names the deck and nothing stands in for a description', async () => {
  const page = await (await view('/@owner/talk')).text()

  expect(page).toContain('<meta property="og:title" content="Talk" />')
  expect(page).not.toContain('class="viewer-description"')
  expect(page).not.toContain('og:description')
})

test('Given a public deck that names a cover image, When opened, Then the image on the deployment origin is offered to services that preview links', async () => {
  await orm
    .update(deployments)
    .set({ cover_path: 'images/og "1".png' })
    .where(eq(deployments.id, talk))

  const page = await (await view('/@owner/talk')).text()

  expect(page).toContain(
    `<meta property="og:image" content="https://d-${talk}.content.example/images/og%20%221%22.png" />`,
  )
  expect(page).toContain(
    '<meta name="twitter:card" content="summary_large_image" />',
  )
})

test('Given a public deck that names no cover image, When opened, Then the cover the service takes of the deployment is offered instead', async () => {
  const page = await (await view('/@owner/talk')).text()

  expect(page).toContain(
    `<meta property="og:image" content="https://slide.example/covers/${talk}.jpg" />`,
  )
  expect(page).toContain(
    '<meta name="twitter:card" content="summary_large_image" />',
  )
})

test.each(['/@owner/talk', '/@owner/talk/6', '/@owner/missing'])(
  'F24-AC9: Given a deck’s frame follows a link to %s, When answered, Then the frame gets the page that asks the viewer to open it, which only this origin may frame',
  async (path) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        headers: { 'Sec-Fetch-Dest': 'iframe' },
      }),
      env,
    )

    expect(response.status).toBe(200)
    const page = await response.text()
    const nonce = /<script nonce="([A-Za-z0-9_-]{20,})">/.exec(page)?.[1]
    expect(page).toContain("type: 'slide:open', path: location.pathname")
    expect(page).not.toContain('<iframe')
    expect(response.headers.get('Content-Security-Policy')).toBe(
      `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
    )
    expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
  },
)

test.each(['/@owner', '/slides', '/'])(
  'F24-AC10: Given a frame requests %s, which is not a deck, When answered, Then it still may not be framed',
  async (path) => {
    const response = await server.fetch(
      new Request(`${TEST_ORIGIN}${path}`, {
        headers: { 'Sec-Fetch-Dest': 'iframe' },
      }),
      env,
    )

    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
    expect(await response.text()).not.toContain('slide:open')
  },
)

test('Given a reader opens a deck, When answered, Then the viewer itself may not be framed', async () => {
  const response = await view('/@owner/talk')

  expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  expect(response.headers.get('Content-Security-Policy')).toContain(
    "frame-ancestors 'none'",
  )
})

test('Given a zero-padded page, When opened, Then it redirects to the one spelling of that page', async () => {
  const response = await view('/@owner/talk/06')

  expect(response.status).toBe(301)
  expect(response.headers.get('location')).toBe('/@owner/talk/6')
})
