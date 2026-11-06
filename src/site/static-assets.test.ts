import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy, unstable_readConfig } from 'wrangler'
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

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const SERVICE_CSS = 'service stylesheet'
const env = {
  ...testEnv(platform.env),
  CONTENT_ORIGIN: 'https://content.example',
  // Stands in for Workers Static Assets, which holds the service's files.
  ASSETS: {
    fetch: async (input: RequestInfo) =>
      new URL(input instanceof Request ? input.url : input).pathname ===
      '/styles.css'
        ? new Response(SERVICE_CSS, { headers: { 'Content-Type': 'text/css' } })
        : new Response('Not found', { status: 404 }),
  },
} as unknown as Env

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
    await db
      .prepare("INSERT INTO upload_files VALUES (?, ?, ?, ?, ?, 'text/css', ?)")
      .bind(id, String(index), path, body.length, 'a'.repeat(63) + index, key)
      .run()
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

const get = (url: string) => server.fetch(new Request(url), env)

test('Given the Worker configuration, When assets are read, Then the Worker runs before Static Assets on every host', () => {
  // Without this, Static Assets answers /styles.css on deployment origins
  // before the Worker can choose the author's file.
  const { assets } = unstable_readConfig({ config: 'wrangler.jsonc' })
  expect(assets?.run_worker_first).toBe(true)
  expect(assets?.binding).toBe('ASSETS')
})

test('Given the management host, When a service file is requested, Then Static Assets answers', async () => {
  const response = await get(`${TEST_ORIGIN}/styles.css`)
  expect(await response.text()).toBe(SERVICE_CSS)
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
