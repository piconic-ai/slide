import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { base64Url } from '../auth/github-oauth'
import { applyMigrations } from '../db/test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const origin = 'https://slide.example'
const now = Math.floor(Date.now() / 1000)
const token = 'T'.repeat(43)

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  for (const table of [
    'upload_files',
    'deployments',
    'repository_bindings',
    'decks',
    'owner_sessions',
  ])
    await db.prepare(`DELETE FROM ${table}`).run()
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  await db.batch([
    db
      .prepare("INSERT INTO owner_sessions VALUES (?, '722500', 'owner', ?, ?)")
      .bind(base64Url(new Uint8Array(digest)), now, now + 3600),
    db.prepare(
      "INSERT INTO decks (id, owner_user_id, created_at) VALUES ('talk', '722500', 1)",
    ),
    // Stored values are rendered as text even if they contain markup.
    db.prepare(
      `INSERT INTO repository_bindings VALUES ('talk', '1', '2', '<b>owner</b>/repo', '["refs/heads/<i>x</i>"]', '722500', 1)`,
    ),
  ])
})
afterAll(() => platform.dispose())

const page = (path: string, signedIn = true) =>
  server.fetch(
    new Request(`${origin}${path}`, {
      headers: signedIn ? { Cookie: `__Host-slide_owner=${token}` } : {},
    }),
    platform.env,
  )

test.each([
  ['/decks', false, 401],
  ['/decks/talk', false, 401],
  ['/decks/missing', true, 404],
  ['/decks/talk?before=bad', true, 404],
])(
  'given %s (signed in: %s), when it renders, then it answers %i under the page policy',
  async (path, signedIn, status) => {
    const response = await page(path, signedIn)
    expect(response.status).toBe(status)
    expect(response.headers.get('content-security-policy')).toContain(
      "default-src 'none'",
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
  },
)

test('given stored values with markup, when the deck list renders, then they are escaped', async () => {
  const body = await (await page('/decks')).text()
  expect(body).not.toContain('<b>owner</b>')
  expect(body).toContain('&lt;b&gt;owner&lt;/b&gt;/repo')
  expect(body).toContain('refs/heads/&lt;i&gt;x&lt;/i&gt;')
})

test('given more deployments than a page, when history renders, then it links to older ones', async () => {
  const insert = db.prepare(
    `INSERT INTO deployments (id, idempotency_key, inventory_digest, source_sha, run_id, run_attempt, actor_id, repository_id, owner_id, source_ref, state, total_bytes, token_hash, created_at, expires_at, credential_expires_at, ready_at, deck_id)
     VALUES (?, ?, 'g', ?, '1', '1', '722500', '1', '2', 'refs/heads/main', 'ready', 1, 'h', ?, ?, ?, ?, 'talk')`,
  )
  await db.batch(
    Array.from({ length: 51 }, (_, index) =>
      insert.bind(
        `dep-${index}`,
        `key-${index}`,
        'a'.repeat(40),
        now - index,
        now + 3600,
        now + 3600,
        now - index,
      ),
    ),
  )
  const first = await (await page('/decks/talk')).text()
  const link = /href="(\/decks\/talk\?before=[^"]+)"/.exec(first)?.[1]
  expect(link).toBeDefined()
  const older = await (await page((link ?? '').replaceAll('&amp;', '&'))).text()
  expect(older).toContain('dep-50')
  expect(older).not.toContain('さらに古い版')
})

test('given the deck ID input, when the browser applies its pattern, then it matches the server rule', async () => {
  const body = await (await page('/decks')).text()
  const pattern = /name="deck"[^>]*pattern="([^"]+)"/.exec(body)?.[1]
  expect(pattern).toBeDefined()
  // Browsers compile pattern as ^(?:pattern)$ with the v flag.
  const rule = new RegExp(`^(?:${pattern})$`, 'v')
  for (const valid of ['talk', 'a', 'my-talk-2026', 'a'.repeat(64)])
    expect(rule.test(valid)).toBe(true)
  for (const invalid of ['Bad_ID', 'talk-', '-talk', 'a'.repeat(65), ''])
    expect(rule.test(invalid)).toBe(false)
})
