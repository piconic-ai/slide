import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { drizzle } from 'drizzle-orm/d1'
import { decks, deployments, uploadFiles } from '../db/schema'
import { authSession } from '../db/auth-schema'
import server from '../app/routes'
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
  for (const table of [uploadFiles, deployments, decks, authSession])
    await orm.delete(table)
  cookie = await signIn(env, 'owner')
  await orm.insert(decks).values({
    id: 'talk',
    slug: 'talk',
    owner_user_id: '722500',
    created_at: 1,
  })
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
  ['/slides', false, 401],
  ['/slides/talk', false, 401],
  ['/slides/missing', true, 404],
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

test('F03-AC37: given a slide, when the list of slides renders, then its row says Edit and not Manage', async () => {
  const body = await (await page('/slides')).text()
  expect(body).toMatch(
    /class="deck-row-edit"\s+href="\/slides\/talk"[^>]*>編集する<\/a/,
  )
  expect(body).not.toContain('管理する')
})

test('F03-AC35 F03-AC65: given a slide, when its editing page renders, then the title is the editing page and the way back says the list of slides', async () => {
  const body = await (await page('/slides/talk')).text()
  expect(body).toContain('<title>スライドの編集 - slide.community</title>')
  expect(body).toMatch(/class="back-link" href="\/slides">‹ スライドの管理<\/a/)
  expect(body).not.toMatch(/1\s*本の管理|の管理<\/h1>/)
})

test('given a slide whose title holds markup, when the list of slides renders, then it is listed and the title is escaped', async () => {
  await orm.insert(deployments).values({
    id: 'titled',
    idempotency_key: 'key-titled',
    inventory_digest: 'g',
    source: 'browser',
    state: 'ready',
    total_bytes: 1,
    token_hash: 'h',
    created_at: now,
    expires_at: now + 3600,
    credential_expires_at: now + 3600,
    ready_at: now,
    deck_id: 'talk',
    title: '<b>Bold</b> "talk"',
  })
  const body = await (await page('/slides')).text()
  expect(body).not.toContain('<b>Bold</b>')
  expect(body).toContain(
    '<a href="/@owner/talk">&lt;b&gt;Bold&lt;/b&gt; &quot;talk&quot;</a>',
  )
  expect(body).toContain('href="/@owner/talk"')
  expect(body).toMatch(
    /<span class="status-chip status-draft"\s*>作者のみ<\/span\s*>/,
  )
})
