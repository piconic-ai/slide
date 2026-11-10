import { drizzle } from 'drizzle-orm/d1'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
import server from '../../server'
import { uploadFiles } from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  resetTables,
  seedDeck,
  seedDeployment,
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
/** The first line of the service's own public/styles.css. */
const SERVICE_CSS = (await readFile('public/styles.css', 'utf8')).split('\n')[0]

beforeAll(() => applyMigrations(db))
beforeEach(async () => {
  await resetTables(db)
  await seedDeck(db, 'talk')
})
afterAll(() => platform.dispose())

async function publish(files: Record<string, string>) {
  const id = await seedDeployment(db, 'talk')
  for (const [index, [path, body]] of Object.entries(files).entries()) {
    const key = `deployments/${id}/files/${index}`
    await platform.env.UPLOADS.put(key, body)
    await orm.insert(uploadFiles).values({
      deployment_id: id,
      id: String(index),
      path,
      size: body.length,
      sha256: 'a'.repeat(63) + index,
      media_type: 'text/css',
      object_key: key,
    })
  }
  const owner = await signIn(env)
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/api/decks/talk/publication`, {
      method: 'POST',
      headers: {
        Cookie: owner,
        Origin: TEST_ORIGIN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'publish',
        deploymentId: id,
        expectedRevision: 0,
      }),
    }),
    env,
  )
  expect(response.status).toBe(200)
  return id
}

const get = (url: string, init?: RequestInit) =>
  server.fetch(new Request(url, init), env)

test('Given the Worker configuration, When assets are read, Then the Worker runs before Static Assets on every host', () => {
  // Without this, Static Assets answers /styles.css on deployment origins
  // before the Worker can choose the author's file.
  const { assets } = unstable_readConfig({ config: 'wrangler.jsonc' })
  expect(assets?.run_worker_first).toBe(true)
  expect(assets?.binding).toBe('ASSETS')
})

test('Given the management host, When a service file is requested, Then Static Assets answers, including HEAD and revalidation', async () => {
  const response = await get(`${TEST_ORIGIN}/styles.css`)
  expect(response.status).toBe(200)
  expect(await response.text()).toContain(SERVICE_CSS)
  const etag = response.headers.get('ETag') ?? ''
  expect(etag).not.toBe('')
  const head = await get(`${TEST_ORIGIN}/styles.css`, { method: 'HEAD' })
  expect(head.status).toBe(200)
  expect(await head.text()).toBe('')
  const revalidated = await get(`${TEST_ORIGIN}/styles.css`, {
    headers: { 'If-None-Match': etag },
  })
  expect(revalidated.status).toBe(304)
})

test('Given the management host, When a browser asks for /favicon.ico, Then the service icon answers as SVG, including HEAD', async () => {
  const svg = await readFile('public/favicon.svg', 'utf8')
  const response = await get(`${TEST_ORIGIN}/favicon.ico`)
  expect(response.status).toBe(200)
  expect(response.headers.get('Content-Type')).toContain('image/svg+xml')
  expect(await response.text()).toBe(svg)
  const head = await get(`${TEST_ORIGIN}/favicon.ico`, { method: 'HEAD' })
  expect(head.status).toBe(200)
})

test('Given a deck without /favicon.ico, When its origin is asked for one, Then the service icon is not served there', async () => {
  const id = await publish({ 'index.html': 'deck' })
  const response = await get(`https://d-${id}.content.example/favicon.ico`)
  expect(response.status).toBe(404)
})

test('Given the management host, When no service file matches or the method is not GET, Then the app answers', async () => {
  const top = await get(`${TEST_ORIGIN}/`)
  expect(top.status).toBe(200)
  expect(top.headers.get('X-Frame-Options')).toBe('DENY')
  const post = await get(`${TEST_ORIGIN}/styles.css`, { method: 'POST' })
  expect(post.status).toBe(404)
  expect(await post.text()).not.toContain(SERVICE_CSS)
})

test('Given the static file lookup fails, When the management host is requested, Then the app still answers', async () => {
  const broken = {
    ...env,
    ASSETS: { fetch: () => Promise.reject(new Error('lookup failed')) },
  } as unknown as Env
  const response = await server.fetch(
    new Request(`${TEST_ORIGIN}/terms`),
    broken,
  )
  expect(response.status).toBe(200)
})

test('Given a deck with its own /styles.css, When its origin is requested, Then the author file is served, not the service file', async () => {
  const id = await publish({ 'index.html': 'deck', 'styles.css': 'author' })
  const response = await get(`https://d-${id}.content.example/styles.css`)
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('author')
})

test('Given a deck without /styles.css, When its origin is requested, Then it is not found rather than the service file', async () => {
  const id = await publish({ 'index.html': 'deck' })
  const response = await get(`https://d-${id}.content.example/styles.css`)
  expect(response.status).toBe(404)
  expect(await response.text()).not.toContain(SERVICE_CSS)
})

test('Given the content apex, When a service file is requested, Then it is not found', async () => {
  const response = await get('https://content.example/styles.css')
  expect(response.status).toBe(404)
})
