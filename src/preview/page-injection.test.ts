import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../app/routes'
import { uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import { pageScript, scriptHashSource } from '../pages/script'
import { injectedValidator } from '../pages/inject'
import {
  openOwnerSession,
  resetTables,
  seedDeck,
  seedDeployment,
  signIn,
  TEST_ORIGIN,
  testEnv,
} from '../publication/test-support'
import { serveStoredFile } from './stored-file-store'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
} as unknown as Env

/** Workers Cache in front of ContentFiles, keyed by the internal path. */
class FakeWorkersCache {
  readonly entries = new Map<string, string>()
  async fetch(request: Request): Promise<Response> {
    const key = new URL(request.url).pathname
    const hit = this.entries.get(key)
    if (hit !== undefined)
      return new Response(hit, { headers: { 'Cf-Cache-Status': 'HIT' } })
    const response = await serveStoredFile(platform.env.UPLOADS, request)
    if (!response.ok) return response
    const text = await response.text()
    this.entries.set(key, text)
    return new Response(text, { headers: { 'Cf-Cache-Status': 'MISS' } })
  }
}

let cache = new FakeWorkersCache()
let owner = ''
let revision = 0
beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
  owner = await signIn(env)
  cache = new FakeWorkersCache()
  revision = 0
})
afterAll(() => platform.dispose())

const get = (id: string, path: string, headers: HeadersInit = {}) =>
  server.fetch(
    new Request(`https://d-${id}.content.example${path}`, { headers }),
    env,
    {
      exports: { ContentFiles: cache },
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
  )

const hex = async (text: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

/** A ready deployment whose files are stored as uploads store them. */
async function deploy(files: Record<string, [string, string]>) {
  const id = await seedDeployment(db, 'talk')
  for (const [index, [path, [type, body]]] of Object.entries(files).entries()) {
    const key = `${id}/${index}/lease`
    await platform.env.UPLOADS.put(key, body)
    await orm.insert(uploadFiles).values({
      deployment_id: id,
      id: String(index),
      path,
      size: body.length,
      sha256: await hex(body),
      media_type: type,
      object_key: key,
    })
  }
  return id
}

async function publish(id: string) {
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/slides/talk/publication`, {
      method: 'POST',
      headers: {
        Cookie: owner,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'publish',
        deploymentId: id,
        expectedRevision: revision++,
      }),
    }),
    env,
  )
  expect(response.status).toBe(200)
}

const HTML = 'text/html; charset=utf-8'
const STRICT = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'self'"><title>t</title></head><body><p>slides</p></body></html>`
const script = pageScript(TEST_ORIGIN)
const tag = `<script>${script}</script>`

test('F03-AC143, F03-AC151, F03-AC152: Given a public deck whose policy allows its own scripts only, When its top page is read, Then the page script is inline before the policy, which is as stored, and so is the stored object', async () => {
  const id = await deploy({ 'index.html': [HTML, STRICT] })
  await publish(id)

  for (const path of ['/', '/index.html']) {
    const response = await get(id, path)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(STRICT.replace('<head>', `<head>${tag}`))
  }
  const [stored] = await orm.select().from(uploadFiles)
  expect(
    await (await platform.env.UPLOADS.get(stored.object_key ?? ''))?.text(),
  ).toBe(STRICT)
})

test('F03-AC153: Given a top page with many meta policies, one holding a character reference, When it is read, Then the page script goes in before them and they are served as stored', async () => {
  const policies =
    `<meta http-equiv="Content-Security-Policy" content="script-src &#39;self&#39;">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'">`.repeat(
      17,
    )
  const html = `<!doctype html><html><head>${policies}<title>t</title></head><body></body></html>`
  const id = await deploy({ 'index.html': [HTML, html] })
  await publish(id)
  expect(await (await get(id, '/')).text()).toBe(
    html.replace('<head>', `<head>${tag}`),
  )
})

test('F03-AC148: Given a public top page, When it is read cold and warm and revalidated, Then the internal cache holds the stored bytes, the validator names the script, and an unchanged copy gets 304', async () => {
  const id = await deploy({ 'index.html': [HTML, STRICT] })
  await publish(id)
  const first = await get(id, '/')
  const etag = first.headers.get('ETag') ?? ''
  expect(first.headers.get('X-Content-Cache')).toBe('MISS')
  expect(etag).toMatch(new RegExp(`^W/"${await hex(STRICT)}-p2-.{16}"$`))
  expect([...cache.entries.values()]).toEqual([STRICT])

  const warm = await get(id, '/')
  expect(warm.headers.get('X-Content-Cache')).toBe('HIT')
  expect(await warm.text()).toBe(await first.text())
  expect(warm.headers.get('ETag')).toBe(etag)

  const revalidated = await get(id, '/', { 'If-None-Match': etag })
  expect(revalidated.status).toBe(304)
  // A copy kept from before the script went in is not taken for this one.
  const stale = await get(id, '/', {
    'If-None-Match': `W/"${await hex(STRICT)}"`,
  })
  expect(stale.status).toBe(200)
  // Nor is a copy served by the rule that put the script after the policy.
  const p1 = injectedValidator(
    await hex(STRICT),
    await scriptHashSource(script),
  ).replace('-p2-', '-p1-')
  const before = await get(id, '/', { 'If-None-Match': `W/"${p1}"` })
  expect(before.status).toBe(200)
  expect(await before.text()).toBe(STRICT.replace('<head>', `<head>${tag}`))
})

test('F03-AC148: Given another viewer origin in the settings, When the same top page is read, Then its validator differs', async () => {
  const id = await deploy({ 'index.html': [HTML, STRICT] })
  await publish(id)
  const etag = (await get(id, '/')).headers.get('ETag')
  const elsewhere = await server.fetch(
    new Request(`https://d-${id}.content.example/`),
    { ...env, PUBLIC_ORIGIN: 'https://other.example' } as unknown as Env,
  )
  expect(elsewhere.headers.get('ETag')).not.toBe(etag)
  expect(await elsewhere.text()).toContain('"https://other.example"')
})

test('F03-AC153: Given HTML pages besides the top one, a stylesheet and a piece of HTML at the top, When they are read, Then each is served as stored', async () => {
  const page = '<!doctype html><head><title>other</title></head>'
  const top = await deploy({
    'index.html': [HTML, '<h1>Cited</h1>'],
    'next/index.html': [HTML, page],
    'notes.html': [HTML, page],
    'site.css': ['text/css', 'head { color: red }'],
  })
  await publish(top)
  expect(await (await get(top, '/')).text()).toBe('<h1>Cited</h1>')
  expect(await (await get(top, '/next/')).text()).toBe(page)
  expect(await (await get(top, '/notes.html')).text()).toBe(page)
  expect(await (await get(top, '/site.css')).text()).toBe('head { color: red }')
})

test('F03-AC153: Given a top page stored as another type, When it is read, Then it is served as stored', async () => {
  const id = await deploy({ 'index.html': ['text/plain', STRICT] })
  await publish(id)
  expect(await (await get(id, '/')).text()).toBe(STRICT)
})

test('F03-AC149: Given an owner-only version, When its owner reads the top page, Then the page script is inline as for readers, and the answer stays private', async () => {
  const id = await deploy({ 'index.html': [HTML, STRICT] })
  const session = await openOwnerSession(env, owner, `/@owner/talk?v=${id}`)
  const response = await get(id, '/', { Cookie: session })
  expect(response.status).toBe(200)
  expect(await response.text()).toBe(STRICT.replace('<head>', `<head>${tag}`))
  expect(response.headers.get('Cache-Control')).toBe(
    'private, no-store, no-transform',
  )
  expect(response.headers.get('ETag')).toBeNull()
  expect(cache.entries.size).toBe(0)
})

test('F03-AC146: Given any deployment origin, When the page script is read from its file, Then it is the text that goes inline, which stands down when another copy runs', async () => {
  const response = await get(crypto.randomUUID(), '/_preview/pages.js')
  const served = await response.text()
  expect(served).toBe(script)
  expect(served).toMatch(/if \(window\[running\]\) return/)
})
