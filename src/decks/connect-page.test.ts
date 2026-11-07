import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { base64Url } from '../auth/github-oauth'
import { applyMigrations } from '../db/test-migrations'
import { ACTION_REF } from './pages'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const origin = 'https://slide.example'
const now = Math.floor(Date.now() / 1000)
const token = 'C'.repeat(43)

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  for (const table of ['repository_bindings', 'decks', 'owner_sessions'])
    await db.prepare(`DELETE FROM ${table}`).run()
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  await db
    .prepare("INSERT INTO owner_sessions VALUES (?, '722500', 'owner', ?, ?)")
    .bind(base64Url(new Uint8Array(digest)), now, now + 3600)
    .run()
})
afterAll(() => platform.dispose())

const page = (path: string, signedIn = true) =>
  server.fetch(
    new Request(`${origin}${path}`, {
      headers: signedIn ? { Cookie: `__Host-slide_owner=${token}` } : {},
    }),
    platform.env,
  )

test('given no sign-in, when the connect page opens, then it asks the author to sign in', async () => {
  const response = await page('/decks/new', false)
  expect(response.status).toBe(401)
  expect(await response.text()).toContain('href="/auth/github"')
})

test('given a signed-in author, when the connect page opens, then it shows the form and a workflow that uses the action', async () => {
  const response = await page('/decks/new')
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const body = await response.text()
  expect(body).toContain('action="/decks/connect"')
  expect(body).toContain('id-token: write')
  expect(body).toContain(`uses: ${ACTION_REF}`)
  expect(body).toContain('/@owner/')
})

test('given a signed-in author with no decks, when the deck list opens, then it links to the connect page instead of showing the form', async () => {
  const body = await (await page('/decks')).text()
  expect(body).toContain('href="/decks/new"')
  expect(body).toContain('まだデッキはありません。')
  expect(body).not.toContain('action="/decks/connect"')
})

test.each(['new', 'connect'])(
  'given the reserved deck ID %s, when the form is posted, then it is rejected before GitHub',
  async (deck) => {
    const response = await server.fetch(
      new Request(`${origin}/decks/connect`, {
        method: 'POST',
        headers: {
          Cookie: `__Host-slide_owner=${token}`,
          Origin: origin,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          deck,
          repository: 'owner/repo',
          branches: 'main',
        }),
      }),
      platform.env,
    )
    expect(response.status).toBe(400)
  },
)
