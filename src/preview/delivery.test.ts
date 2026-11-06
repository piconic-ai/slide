import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { SESSION_IDLE_SECONDS } from './lifetime'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
})
afterAll(() => platform.dispose())

/** A ready deployment with stored files. */
async function deploy(files: Record<string, string>) {
  const id = await seedDeployment(db, 'talk')
  for (const [index, [path, body]] of Object.entries(files).entries()) {
    const key = `deployments/${id}/files/${index}`
    await platform.env.UPLOADS.put(key, body)
    await db
      .prepare(
        "INSERT INTO upload_files VALUES (?, ?, ?, ?, ?, 'text/html; charset=utf-8', ?)",
      )
      .bind(id, String(index), path, body.length, 'f'.repeat(63) + index, key)
      .run()
  }
  return id
}

const get = (id: string, path: string, headers: HeadersInit = {}) =>
  server.fetch(
    new Request(`https://d-${id}.content.example${path}`, { headers }),
    env,
  )

/** Opens an owner-only session for the deployment; returns its cookie. */
async function openAsOwner(owner: string, id: string) {
  const page = await server.fetch(
    new Request(`${TEST_ORIGIN}/decks/talk/deployments/${id}/preview`, {
      method: 'POST',
      headers: { Cookie: owner, Origin: TEST_ORIGIN },
    }),
    env,
  )
  const token = /name="token" value="([^"]+)"/.exec(await page.text())?.[1]
  const launched = await server.fetch(
    new Request(`https://d-${id}.content.example/_preview/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: token ?? '' }).toString(),
    }),
    env,
  )
  expect(launched.status).toBe(303)
  return launched.headers.getSetCookie()[0]?.split(';')[0] ?? ''
}

let revision = 0
async function act(owner: string, body: Record<string, unknown>) {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/decks/talk/publication`, {
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
beforeEach(() => {
  revision = 0
})

test('Given a draft, When fetched, Then only the owner session reads HTML and assets with private headers', async () => {
  const owner = await signIn(env)
  const draft = await deploy({ 'index.html': '<h1>B</h1>', 'a/app.js': 'x' })
  for (const path of ['/', '/index.html', '/a/app.js'])
    expect((await get(draft, path)).status).toBe(404)
  const session = await openAsOwner(owner, draft)
  const page = await get(draft, '/', { Cookie: session })
  expect(page.status).toBe(200)
  expect(await page.text()).toBe('<h1>B</h1>')
  expect(page.headers.get('Cache-Control')).toBe('private, no-store')
  expect(page.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(page.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  expect(page.headers.get('Content-Security-Policy')).toBe(
    `sandbox allow-scripts allow-same-origin; worker-src 'none'; frame-ancestors ${TEST_ORIGIN}`,
  )
  expect((await get(draft, '/a/app.js', { Cookie: session })).status).toBe(200)
})

test('Given public A and draft B, When each is fetched, Then A is anonymous and revalidated, and B stays owner-only', async () => {
  const owner = await signIn(env)
  const a = await deploy({ 'index.html': 'A' })
  const b = await deploy({ 'index.html': 'B' })
  await act(owner, { action: 'publish', deploymentId: a })
  const publicPage = await get(a, '/')
  expect(publicPage.status).toBe(200)
  expect(publicPage.headers.get('Cache-Control')).toBe('no-cache')
  const etag = publicPage.headers.get('ETag') ?? ''
  expect((await get(a, '/', { 'If-None-Match': etag })).status).toBe(304)
  expect((await get(b, '/')).status).toBe(404)
  const session = await openAsOwner(owner, b)
  expect(await (await get(b, '/', { Cookie: session })).text()).toBe('B')
  // The session belongs to B's origin only.
  expect(
    (await get(a, '/', { Cookie: session })).headers.get('Cache-Control'),
  ).toBe('no-cache')
})

test('Given B is published, When its owner session is used, Then it is revoked and A is no longer served', async () => {
  const owner = await signIn(env)
  const a = await deploy({ 'index.html': 'A' })
  const b = await deploy({ 'index.html': 'B' })
  await act(owner, { action: 'publish', deploymentId: a })
  const session = await openAsOwner(owner, b)
  await act(owner, { action: 'publish', deploymentId: b })
  expect((await get(b, '/', { Cookie: session })).status).toBe(200)
  expect(
    await db.prepare('SELECT COUNT(*) AS n FROM content_sessions').first('n'),
  ).toBe(0)
  expect((await get(a, '/index.html')).status).toBe(404)
  // An explicit rollback brings A back.
  await act(owner, { action: 'publish', deploymentId: a })
  expect((await get(a, '/')).status).toBe(200)
  expect((await get(b, '/')).status).toBe(404)
})

test('Given a pause, When fetched, Then anonymous reads stop, owner sessions end, and the owner can reopen', async () => {
  const owner = await signIn(env)
  const a = await deploy({ 'index.html': 'A', 'img.png': 'png' })
  await act(owner, { action: 'publish', deploymentId: a })
  const b = await deploy({ 'index.html': 'B' })
  const session = await openAsOwner(owner, b)
  await act(owner, { action: 'pause' })
  for (const path of ['/', '/img.png'])
    expect((await get(a, path)).status).toBe(404)
  const ended = await get(b, '/', { Cookie: session })
  expect(ended.status).toBe(401)
  expect(await ended.text()).toContain('開き直してください')
  const reopened = await openAsOwner(owner, a)
  expect((await get(a, '/', { Cookie: reopened })).status).toBe(200)
  await act(owner, { action: 'resume' })
  expect((await get(a, '/')).status).toBe(200)
})

test('Given a launch issued before publishing, When used afterwards, Then it opens nothing', async () => {
  const owner = await signIn(env)
  const b = await deploy({ 'index.html': 'B' })
  const page = await server.fetch(
    new Request(`${TEST_ORIGIN}/decks/talk/deployments/${b}/preview`, {
      method: 'POST',
      headers: { Cookie: owner, Origin: TEST_ORIGIN },
    }),
    env,
  )
  const token = /name="token" value="([^"]+)"/.exec(await page.text())?.[1]
  await act(owner, { action: 'publish', deploymentId: b })
  const launched = await server.fetch(
    new Request(`https://d-${b}.content.example/_preview/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: token ?? '' }).toString(),
    }),
    env,
  )
  expect(launched.status).toBe(403)
})

test('Given an owner session, When it nears idle expiry, Then a request extends it, and an expired one asks to reopen', async () => {
  const owner = await signIn(env)
  const b = await deploy({ 'index.html': 'B' })
  const session = await openAsOwner(owner, b)
  const now = Math.floor(Date.now() / 1000)
  await db
    .prepare('UPDATE content_sessions SET expires_at = ?')
    .bind(now + 60)
    .run()
  expect((await get(b, '/', { Cookie: session })).status).toBe(200)
  const renewed = Number(
    await db
      .prepare('SELECT expires_at FROM content_sessions')
      .first('expires_at'),
  )
  expect(renewed).toBeGreaterThanOrEqual(now + SESSION_IDLE_SECONDS)
  await db
    .prepare('UPDATE content_sessions SET created_at = 0, expires_at = 1')
    .run()
  expect((await get(b, '/', { Cookie: session })).status).toBe(401)
})

test('Given an owner session cookie, When it is sent to the management API, Then it authenticates nothing', async () => {
  const owner = await signIn(env)
  const b = await deploy({ 'index.html': 'B' })
  const session = await openAsOwner(owner, b)
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/decks`, { headers: { Cookie: session } }),
    env,
  )
  expect(response.status).toBe(401)
})

test.each([
  ['a missing file', '/missing.html'],
  ['an encoded parent segment', '/a%2F..%2Findex.html'],
  ['the reserved prefix', '/_preview/launch'],
])(
  'Given %s, When the public deployment is fetched, Then it is not found',
  async (_, path) => {
    const owner = await signIn(env)
    const a = await deploy({ 'index.html': 'A' })
    await act(owner, { action: 'publish', deploymentId: a })
    expect((await get(a, path)).status).toBe(404)
  },
)
