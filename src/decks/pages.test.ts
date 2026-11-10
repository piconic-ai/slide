import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { drizzle } from 'drizzle-orm/d1'
import {
  decks,
  deployments,
  repositoryBindings,
  uploadFiles,
} from '../db/schema'
import { authSession } from '../db/auth-schema'
import server from '../../server'
import { signIn, testEnv } from '../publication/test-support'
import { applyMigrations } from '../db/test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const origin = 'https://slide.example'
const env = testEnv(platform.env)
let cookie = ''
const now = Math.floor(Date.now() / 1000)

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  for (const table of [
    uploadFiles,
    deployments,
    repositoryBindings,
    decks,
    authSession,
  ])
    await orm.delete(table)
  cookie = await signIn(env, 'owner')
  await orm.batch([
    orm
      .insert(decks)
      .values({ id: 'talk', owner_user_id: '722500', created_at: 1 }),
    orm.insert(repositoryBindings).values({
      deck_id: 'talk',
      repository_id: '1',
      repository_owner_id: '2',
      repository_full_name: '<b>owner</b>/repo',
      allowed_refs: '["refs/heads/<i>x</i>"]',
      verified_by: '722500',
      verified_at: 1,
    }),
  ])
})
afterAll(() => platform.dispose())

const page = (path: string, signedIn = true) =>
  server.fetch(
    new Request(`${origin}${path}`, {
      headers: signedIn ? { Cookie: cookie } : {},
    }),
    env,
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
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform')
  },
)

test('given stored values with markup, when the deck list renders, then they are escaped', async () => {
  const body = await (await page('/decks')).text()
  expect(body).not.toContain('<b>owner</b>')
  expect(body).toContain('&lt;b&gt;owner&lt;/b&gt;/repo')
  expect(body).toContain('refs/heads/&lt;i&gt;x&lt;/i&gt;')
})

test('given more deployments than a page, when history renders, then it links to older ones', async () => {
  const insert = (index: number) =>
    orm.insert(deployments).values({
      id: `dep-${index}`,
      idempotency_key: `key-${index}`,
      inventory_digest: 'g',
      source_sha: 'a'.repeat(40),
      run_id: '1',
      run_attempt: '1',
      actor_id: '722500',
      repository_id: '1',
      owner_id: '2',
      source_ref: 'refs/heads/main',
      state: 'ready',
      total_bytes: 1,
      token_hash: 'h',
      created_at: now - index,
      expires_at: now + 3600,
      credential_expires_at: now + 3600,
      ready_at: now - index,
      deck_id: 'talk',
    })
  await orm.batch([
    insert(0),
    ...Array.from({ length: 50 }, (_, index) => insert(index + 1)),
  ])
  const first = await (await page('/decks/talk')).text()
  const link = /href="(\/decks\/talk\?before=[^"]+)"/.exec(first)?.[1]
  expect(link).toBeDefined()
  const older = await (await page((link ?? '').replaceAll('&amp;', '&'))).text()
  expect(older).toContain('dep-50')
  expect(older).not.toContain('さらに古い版')
})

test('given the deck ID input, when the browser applies its pattern, then it matches the server rule', async () => {
  const body = await (await page('/decks/new')).text()
  const pattern = /name="deck"[^>]*pattern="([^"]+)"/.exec(body)?.[1]
  expect(pattern).toBeDefined()
  // Browsers compile pattern as ^(?:pattern)$ with the v flag.
  const rule = new RegExp(`^(?:${pattern})$`, 'v')
  for (const valid of ['talk', 'a', 'my-talk-2026', 'a'.repeat(64)])
    expect(rule.test(valid)).toBe(true)
  for (const invalid of ['Bad_ID', 'talk-', '-talk', 'a'.repeat(65), ''])
    expect(rule.test(invalid)).toBe(false)
})
