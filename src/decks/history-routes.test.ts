import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from 'vitest'
import { getPlatformProxy } from 'wrangler'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const origin = 'https://slide.example'
const env = {
  ...platform.env,
  GITHUB_APP_CLIENT_ID: 'Iv1.client',
  GITHUB_APP_CLIENT_SECRET: 'secret',
  PUBLIC_ORIGIN: origin,
} as unknown as Env
const now = Math.floor(Date.now() / 1000)

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
  await db.batch([
    db.prepare("INSERT INTO decks VALUES ('talk', '722500', 1)"),
    db.prepare("INSERT INTO decks VALUES ('theirs', '1', 1)"),
  ])
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const request = (path: string, cookie = '') =>
  server.fetch(
    new Request(`${origin}${path}`, { headers: { Cookie: cookie } }),
    env,
  )

async function signIn() {
  const start = await request('/auth/github')
  const state = new URL(start.headers.get('location') ?? '').searchParams.get(
    'state',
  )
  vi.stubGlobal('fetch', async (input: RequestInfo) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/access_token'))
      return Response.json({ access_token: 'gho_x' })
    if (url.endsWith('/user'))
      return Response.json({ id: 722500, login: 'owner' })
    return new Response(null, { status: 204 })
  })
  const oauth = start.headers.getSetCookie()[0]?.split(';')[0] ?? ''
  const callback = await server.fetch(
    new Request(`${origin}/auth/github/callback?code=c&state=${state}`, {
      headers: { Cookie: oauth },
    }),
    env,
  )
  return (
    callback.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('__Host-slide_owner='))
      ?.split(';')[0] ?? ''
  )
}

let sequence = 0
async function seedDeployment(
  deck: string,
  state: 'uploading' | 'ready' | 'failed',
  created: number,
  files: { path: string; received: boolean }[],
) {
  const id = `dep-${++sequence}`
  await db
    .prepare(
      `INSERT INTO deployments (id, idempotency_key, inventory_digest, source_sha, run_id, run_attempt, actor_id, repository_id, owner_id, source_ref, state, total_bytes, token_hash, created_at, expires_at, credential_expires_at, ready_at, failure_reason, deck_id)
       VALUES (?, ?, 'g', ?, '7', '1', '722500', '1', '2', 'refs/heads/main', ?, 1, 'h', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      `key-${id}`,
      'b'.repeat(40),
      state,
      created,
      now + 3600,
      now + 3600,
      state === 'ready' ? created + 1 : null,
      state === 'failed' ? 'author_bytes_exceeded' : null,
      deck,
    )
    .run()
  for (const [index, file] of files.entries())
    await db
      .prepare(
        `INSERT INTO upload_files VALUES (?, ?, ?, 1, ?, 'text/html', ?)`,
      )
      .bind(
        id,
        String(index),
        file.path,
        'c'.repeat(64),
        file.received ? `${id}/k` : null,
      )
      .run()
  return id
}

test('given deployments in several states, when the owner reads history, then commits, states, reasons, and missing files are listed newest first', async () => {
  const session = await signIn()
  const ready = await seedDeployment('talk', 'ready', now - 30, [
    { path: 'index.html', received: true },
  ])
  const refused = await seedDeployment('talk', 'failed', now - 20, [])
  const partial = await seedDeployment('talk', 'uploading', now - 10, [
    { path: 'index.html', received: true },
    { path: 'app.js', received: false },
  ])
  await seedDeployment('theirs', 'ready', now, [])
  const response = await request('/api/decks/talk/deployments', session)
  expect(response.status).toBe(200)
  const body = (await response.json()) as {
    deployments: {
      deploymentId: string
      state: string
      failureReason: string | null
      files: unknown
    }[]
  }
  expect(body.deployments.map(({ deploymentId }) => deploymentId)).toEqual([
    partial,
    refused,
    ready,
  ])
  expect(body.deployments[0]).toMatchObject({
    state: 'uploading',
    commit: 'b'.repeat(40),
    ref: 'refs/heads/main',
    files: { total: 2, received: 1, missing: ['app.js'], missingNotShown: 0 },
  })
  expect(body.deployments[1]).toMatchObject({
    state: 'failed',
    failureReason: 'author_bytes_exceeded',
  })
})

test('given a cursor, when history is read, then only older deployments are returned', async () => {
  const session = await signIn()
  await seedDeployment('talk', 'ready', now - 30, [])
  const newer = await seedDeployment('talk', 'ready', now - 10, [])
  const page = await request(
    `/api/decks/talk/deployments?before=${now - 20}`,
    session,
  )
  const body = (await page.json()) as {
    deployments: { deploymentId: string }[]
  }
  expect(
    body.deployments.map(({ deploymentId }) => deploymentId),
  ).not.toContain(newer)
  expect(body.deployments).toHaveLength(1)
  expect(
    (await request('/api/decks/talk/deployments?before=x', session)).status,
  ).toBe(400)
})

test.each([
  ["another owner's deck", '/api/decks/theirs/deployments', 404],
  ['an unknown deck', '/api/decks/missing/deployments', 404],
  ['an invalid deck ID', '/api/decks/Not_A_Deck/deployments', 404],
])(
  'given %s, when the owner reads it, then nothing is revealed',
  async (_n, path, status) => {
    const session = await signIn()
    await seedDeployment('theirs', 'ready', now, [
      { path: 'secret.html', received: true },
    ])
    const response = await request(path, session)
    expect(response.status).toBe(status)
    expect(await response.text()).not.toContain('secret.html')
  },
)

test.each([['/api/decks/talk/deployments', 401]])(
  'given no owner session, when %s is read, then it asks for sign-in',
  async (path, status) => {
    await seedDeployment('talk', 'ready', now, [])
    expect((await request(path)).status).toBe(status)
  },
)
