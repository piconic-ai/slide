import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { suspensions, uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { applyOperatorCommand } from '../publication/takedown-store'
import {
  OWNER_ID,
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
  openOwnerSession,
} from '../publication/test-support'
import { serveStoredFile } from './stored-file-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

/**
 * Stands in for Workers Cache in front of the ContentFiles entrypoint. As
 * documented, the key is the request path and query without the host, and
 * a response is stored only when its Cache-Control allows it.
 */
class FakeWorkersCache {
  readonly entries = new Map<string, ArrayBuffer>()
  calls = 0
  async fetch(request: Request): Promise<Response> {
    this.calls++
    const url = new URL(request.url)
    const key = url.pathname + url.search
    const hit = this.entries.get(key)
    if (hit) return new Response(hit, { headers: { 'Cf-Cache-Status': 'HIT' } })
    const response = await serveStoredFile(platform.env.UPLOADS, request)
    if (!response.ok) return response
    const bytes = await response.arrayBuffer()
    if (/\bpublic\b/.test(response.headers.get('Cache-Control') ?? ''))
      this.entries.set(key, bytes)
    return new Response(bytes, { headers: { 'Cf-Cache-Status': 'MISS' } })
  }
}

let cache = new FakeWorkersCache()
let owner = ''
const revisions = new Map<string, number>()
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'one')
  await seedDeck(db, 'two')
  owner = await signIn(env)
  cache = new FakeWorkersCache()
  revisions.clear()
})
afterAll(() => platform.dispose())

const context = () =>
  ({
    exports: { ContentFiles: cache },
    waitUntil: () => {},
    passThroughOnException: () => {},
  }) as unknown as ExecutionContext

const get = (id: string, path: string, headers: HeadersInit = {}) =>
  server.fetch(
    new Request(`https://d-${id}.content.example${path}`, { headers }),
    env,
    context(),
  )

/** A ready deployment of `deck` whose files are stored as uploads store them. */
async function deploy(deck: string, files: Record<string, string>) {
  const id = await seedDeployment(db, deck)
  for (const [index, [path, body]] of Object.entries(files).entries()) {
    const key = `${id}/${index}/lease`
    await platform.env.UPLOADS.put(key, body)
    const digest = [
      ...new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    await orm.insert(uploadFiles).values({
      deployment_id: id,
      id: String(index),
      path,
      size: body.length,
      sha256: digest,
      media_type: 'text/html',
      object_key: key,
    })
  }
  return id
}

async function act(deck: string, body: Record<string, unknown>) {
  const revision = revisions.get(deck) ?? 0
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides/${deck}/publication`, {
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
  revisions.set(deck, revision + 1)
}

async function read(id: string, path: string) {
  const response = await get(id, path)
  return {
    status: response.status,
    body: await response.text(),
    cache: response.headers.get('X-Content-Cache'),
  }
}

test('Given two decks with different files at the same paths, When read cold and warm, Then neither receives the other bytes', async () => {
  const a = await deploy('one', { 'index.html': 'A page', 'app.js': 'A js' })
  const b = await deploy('two', { 'index.html': 'B page', 'app.js': 'B js' })
  await act('one', { action: 'publish', deploymentId: a })
  await act('two', { action: 'publish', deploymentId: b })
  for (const round of ['MISS', 'HIT']) {
    expect(await read(a, '/')).toEqual({
      status: 200,
      body: 'A page',
      cache: round,
    })
    expect(await read(b, '/')).toEqual({
      status: 200,
      body: 'B page',
      cache: round,
    })
    expect(await read(a, '/app.js')).toMatchObject({
      body: 'A js',
      cache: round,
    })
    expect(await read(b, '/app.js')).toMatchObject({
      body: 'B js',
      cache: round,
    })
  }
  expect(cache.entries.size).toBe(4)
})

test('Given a warm cache, When publication stops, Then the old HTML and assets are denied while the entries remain', async () => {
  const id = await deploy('one', { 'index.html': 'page', 'a/app.js': 'js' })
  await act('one', { action: 'publish', deploymentId: id })
  expect((await read(id, '/')).cache).toBe('MISS')
  expect((await read(id, '/a/app.js')).cache).toBe('MISS')
  await act('one', { action: 'pause' })
  const calls = cache.calls
  for (const path of ['/', '/index.html', '/a/app.js'])
    expect((await get(id, path)).status).toBe(404)
  // Denied before the cache is consulted; nothing was purged.
  expect(cache.calls).toBe(calls)
  expect(cache.entries.size).toBe(2)
})

test('Given a warm cache, When the deck is replaced, Then the old deployment is denied and the new one is served', async () => {
  const old = await deploy('one', { 'index.html': 'old' })
  const next = await deploy('one', { 'index.html': 'new' })
  await act('one', { action: 'publish', deploymentId: old })
  expect((await read(old, '/')).body).toBe('old')
  await act('one', { action: 'publish', deploymentId: next })
  expect((await get(old, '/')).status).toBe(404)
  expect(await read(next, '/')).toMatchObject({ status: 200, body: 'new' })
})

test('Given an owner-only draft, When the owner reads it, Then bytes bypass the shared cache and stay private', async () => {
  const draft = await deploy('one', { 'index.html': 'draft' })
  const session = await openOwnerSession(env, owner, `/@owner/one?v=${draft}`)
  const response = await get(draft, '/', { Cookie: session })
  expect(await response.text()).toBe('draft')
  expect(response.headers.get('Cache-Control')).toBe(
    'private, no-store, no-transform',
  )
  expect(response.headers.get('ETag')).toBeNull()
  expect(cache.calls).toBe(0)
  expect((await get(draft, '/')).status).toBe(404)
})

test.each([
  ['the weak validator', (etag: string) => etag, 304],
  ['its strong form', (etag: string) => etag.replace(/^W\//, ''), 304],
  ['a list containing it', (etag: string) => `"other", ${etag}`, 304],
  ['a wildcard', () => '*', 304],
  ['another validator', () => 'W/"other"', 200],
])(
  'Given %s in If-None-Match, When a public file is revalidated, Then it answers %i',
  async (_, header, status) => {
    const id = await deploy('one', { 'index.html': 'page' })
    await act('one', { action: 'publish', deploymentId: id })
    const first = await get(id, '/')
    const etag = first.headers.get('ETag') ?? ''
    // The top page's validator also names the page script that goes in.
    expect(etag).toMatch(/^W\/"[0-9a-f]{64}-p1-[A-Za-z0-9+/]{16}"$/)
    expect((await get(id, '/', { 'If-None-Match': header(etag) })).status).toBe(
      status,
    )
  },
)

test('Given an empty public file, When read cold and warm, Then it is served as an empty 200', async () => {
  const id = await deploy('one', { 'index.html': 'page', 'empty.css': '' })
  await act('one', { action: 'publish', deploymentId: id })
  expect(await read(id, '/empty.css')).toEqual({
    status: 200,
    body: '',
    cache: 'MISS',
  })
  expect((await read(id, '/empty.css')).status).toBe(200)
})

test('Given a public file, When requested with HEAD, Then it answers with headers and no body', async () => {
  const id = await deploy('one', { 'index.html': 'page' })
  await act('one', { action: 'publish', deploymentId: id })
  const response = await server.fetch(
    new Request(`https://d-${id}.content.example/`, { method: 'HEAD' }),
    env,
    context(),
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('ETag')).toMatch(/^W\//)
  expect(await response.text()).toBe('')
})

test('F17-AC9: Given a warm cache, When an operator hides the deck, Then the next requests are denied before the cache is consulted, and a release serves them again', async () => {
  const id = await deploy('one', { 'index.html': 'page', 'a/app.js': 'js' })
  await act('one', { action: 'publish', deploymentId: id })
  expect((await read(id, '/')).cache).toBe('MISS')
  expect((await read(id, '/a/app.js')).cache).toBe('MISS')
  expect((await read(id, '/')).cache).toBe('HIT')
  await applyOperatorCommand(db, {
    deckId: 'one',
    command: { kind: 'hide', reason: 'fake sign-in page', operator: 'op' },
    now: 1,
  })
  const calls = cache.calls
  for (const path of ['/', '/index.html', '/a/app.js'])
    expect((await get(id, path)).status).toBe(404)
  expect(cache.calls).toBe(calls)
  await applyOperatorCommand(db, {
    deckId: 'one',
    command: { kind: 'release' },
    now: 2,
  })
  expect(await read(id, '/')).toMatchObject({ status: 200, body: 'page' })
})

test('F17-AC15: Given a public deck served from a warm cache, When its owner is suspended, Then the next HTML and asset requests are refused before the cache is consulted', async () => {
  const id = await deploy('one', { 'index.html': 'page', 'a/app.js': 'js' })
  await act('one', { action: 'publish', deploymentId: id })
  expect((await read(id, '/')).cache).toBe('MISS')
  expect((await read(id, '/a/app.js')).cache).toBe('MISS')
  expect((await read(id, '/')).cache).toBe('HIT')
  expect((await read(id, '/a/app.js')).cache).toBe('HIT')
  await orm.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'fake sign-in page',
    suspended_at: 1,
    suspended_by: 'op@example.com',
  })

  const calls = cache.calls
  for (const path of ['/', '/index.html', '/a/app.js']) {
    const response = await get(id, path)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not found')
  }
  expect(cache.calls).toBe(calls)
  expect(cache.entries.size).toBe(2)
})
