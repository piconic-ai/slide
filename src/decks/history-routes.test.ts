import { signIn as sharedSignIn } from '../publication/test-support'
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
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  decks,
  deployments,
  repositoryBindings,
  uploadFiles,
} from '../db/schema'
import { authSession } from '../db/auth-schema'
import server from '../../server'
import { applyMigrations } from '../db/test-migrations'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = platform.env.DB
const orm = drizzle(db)
const origin = 'https://slide.example'
const env = {
  ...platform.env,
  GITHUB_APP_CLIENT_ID: 'Iv1.client',
  GITHUB_APP_CLIENT_SECRET: 'secret',
  BETTER_AUTH_SECRET: 'test-only-better-auth-secret-32-bytes-long',
  PUBLIC_ORIGIN: origin,
} as unknown as Env
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
  await orm.insert(decks).values([
    { id: 'talk', owner_user_id: '722500', created_at: 1 },
    { id: 'theirs', owner_user_id: '1', created_at: 1 },
  ])
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => platform.dispose())

const request = (path: string, cookie = '') =>
  server.fetch(
    new Request(`${origin}${path}`, { headers: { Cookie: cookie } }),
    env,
  )

const signIn = () => sharedSignIn(env)

let sequence = 0
async function seedDeployment(
  deck: string,
  state: 'uploading' | 'ready' | 'failed',
  created: number,
  files: { path: string; received: boolean }[],
) {
  const id = `dep-${++sequence}`
  await orm.insert(deployments).values({
    id,
    idempotency_key: `key-${id}`,
    inventory_digest: 'g',
    source_sha: 'b'.repeat(40),
    run_id: '7',
    run_attempt: '1',
    actor_id: '722500',
    repository_id: '1',
    owner_id: '2',
    source_ref: 'refs/heads/main',
    state,
    total_bytes: 1,
    token_hash: 'h',
    created_at: created,
    expires_at: now + 3600,
    credential_expires_at: now + 3600,
    ready_at: state === 'ready' ? created + 1 : null,
    failure_reason: state === 'failed' ? 'author_bytes_exceeded' : null,
    deck_id: deck,
  })
  for (const [index, file] of files.entries())
    await orm.insert(uploadFiles).values({
      deployment_id: id,
      id: String(index),
      path: file.path,
      size: 1,
      sha256: 'c'.repeat(64),
      media_type: 'text/html',
      object_key: file.received ? `${id}/k` : null,
    })
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

test('given more deployments than a page with equal start times, when every page is followed, then each appears exactly once', async () => {
  const session = await signIn()
  const seeded = new Set<string>()
  for (let index = 0; index < 52; index++)
    seeded.add(await seedDeployment('talk', 'ready', now - 5, []))
  const seen: string[] = []
  let cursor: string | null = null
  do {
    const query: string = cursor ? `?before=${cursor}` : ''
    const response = await request(
      `/api/decks/talk/deployments${query}`,
      session,
    )
    const body = (await response.json()) as {
      deployments: { deploymentId: string }[]
      nextCursor: string | null
    }
    seen.push(...body.deployments.map(({ deploymentId }) => deploymentId))
    cursor = body.nextCursor
  } while (cursor)
  expect(seen).toHaveLength(52)
  expect(new Set(seen)).toEqual(seeded)
})

test.each(['', '0', '-1', 'x', '12', '12.', '.id', '1.a b'])(
  'given the cursor %j, when history is read, then it is rejected',
  async (cursor) => {
    const session = await signIn()
    const response = await request(
      `/api/decks/talk/deployments?before=${encodeURIComponent(cursor)}`,
      session,
    )
    expect([400]).toContain(response.status)
  },
)

test('given an expired session with many missing files, when history is read, then it is expired and the list is bounded', async () => {
  const session = await signIn()
  const id = await seedDeployment(
    'talk',
    'uploading',
    now - 5,
    Array.from({ length: 25 }, (_, index) => ({
      path: `f${String(index).padStart(2, '0')}.js`,
      received: false,
    })),
  )
  await orm
    .update(deployments)
    .set({ expires_at: now - 1 })
    .where(eq(deployments.id, id))
  const body = (await (
    await request('/api/decks/talk/deployments', session)
  ).json()) as {
    deployments: {
      state: string
      files: { missing: string[]; missingNotShown: number }
    }[]
  }
  expect(body.deployments[0]?.state).toBe('expired')
  expect(body.deployments[0]?.files.missing).toHaveLength(20)
  expect(body.deployments[0]?.files.missingNotShown).toBe(5)
})

test.each([
  ["another owner's deck", '/api/decks/theirs/deployments', 404],
  ['an unknown deck', '/api/decks/missing/deployments', 404],
  ['an invalid deck ID', '/api/decks/Not_A_Deck/deployments', 404],
  ["another owner's deck page", '/decks/theirs', 404],
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

test.each([
  ['/api/decks/talk/deployments', 401],
  ['/decks/talk', 401],
  ['/decks', 401],
])(
  'given no owner session, when %s is read, then it asks for sign-in',
  async (path, status) => {
    await seedDeployment('talk', 'ready', now, [])
    expect((await request(path)).status).toBe(status)
  },
)

test('given a path with markup, when the history page renders, then it is escaped under a strict policy', async () => {
  const session = await signIn()
  await seedDeployment('talk', 'uploading', now, [
    { path: '<img src=x onerror=alert(1)>.js', received: false },
  ])
  const response = await request('/decks/talk', session)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-security-policy')).toContain(
    "default-src 'none'",
  )
  const page = await response.text()
  expect(page).not.toContain('<img src=x')
  expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;.js')
  expect(page).toContain('未受領 1 件')
})
