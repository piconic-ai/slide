import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { z } from 'zod'
import { uploadsApi } from './api'
import { DEFAULT_UPLOAD_LIMITS } from './limits'

vi.mock('./oidc', () => ({
  verifyGitHubToken: vi.fn(async () => ({
    repository_id: '1446590227',
    repository_owner_id: '248307881',
    actor_id: '722500',
    ref: 'refs/heads/main',
    sha: 'a'.repeat(40),
    run_id: '1',
    run_attempt: '1',
  })),
}))

const platform = await getPlatformProxy<Env>({ persist: false })
const inventory = {
  entry: 'index.html',
  files: [{ path: 'index.html', size: 1, sha256: 'a'.repeat(64) }],
}
const receiptSchema = z.object({
  deploymentId: z.string(),
  credential: z.string(),
  state: z.enum(['uploading', 'ready']),
  commit: z.string(),
  files: z.array(
    z.object({ id: z.string(), path: z.string(), received: z.boolean() }),
  ),
})
const start = (env: Env = platform.env) =>
  uploadsApi.request(
    'http://localhost/',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer local-oidc-token-123456789' },
      body: JSON.stringify(inventory),
    },
    env,
  )

beforeAll(async () => {
  const migration = await readFile('migrations/0001_uploads.sql', 'utf8')
  await platform.env.DB.batch(
    migration
      .split(';')
      .filter((sql) => sql.trim())
      .map((sql) => platform.env.DB.prepare(sql)),
  )
})
beforeEach(async () => {
  await platform.env.DB.batch([
    platform.env.DB.prepare('DELETE FROM upload_files'),
    platform.env.DB.prepare('DELETE FROM deployments'),
  ])
})
afterAll(() => platform.dispose())

test('given an interrupted upload, when replayed, then credentials rotate and the file map is repaired', async () => {
  const first = await start()
  expect(first.status).toBe(201)
  const receipt = receiptSchema.parse(await first.json())
  expect(receipt).toMatchObject({
    state: 'uploading',
    commit: 'a'.repeat(40),
    files: [{ id: '0', path: 'index.html', received: false }],
  })
  await platform.env.DB.prepare('DELETE FROM upload_files').run()
  const replay = await start()
  expect(replay.status).toBe(201)
  const repaired = receiptSchema.parse(await replay.json())
  expect(repaired.deploymentId).toBe(receipt.deploymentId)
  expect(repaired.files).toEqual(receipt.files)
  expect(repaired.credential).not.toBe(receipt.credential)
  const getReceipt = (credential: string) =>
    uploadsApi.request(
      `http://localhost/${receipt.deploymentId}`,
      { headers: { Authorization: `Bearer ${credential}` } },
      platform.env,
    )
  expect((await getReceipt(receipt.credential)).status).toBe(401)
  expect((await getReceipt(repaired.credential)).status).toBe(200)
})

test.each([
  [
    'total bytes',
    `total_bytes=${DEFAULT_UPLOAD_LIMITS.authorBytes}, state='ready'`,
    1,
  ],
  ['active sessions', 'total_bytes=0', DEFAULT_UPLOAD_LIMITS.activeSessions],
  [
    'daily starts',
    "total_bytes=0, state='ready'",
    DEFAULT_UPLOAD_LIMITS.startsPerDay,
  ],
])(
  'given the %s quota is reached, when an upload starts, then it is rejected',
  async (_name, update, count) => {
    expect((await start()).status).toBe(201)
    await platform.env.DB.prepare(
      `UPDATE deployments SET idempotency_key='seed', ${update}`,
    ).run()
    for (let index = 1; index < count; index++) {
      await platform.env.DB.prepare(
        `INSERT INTO deployments SELECT ?,?,inventory_digest,source_sha,run_id,run_attempt,actor_id,repository_id,owner_id,source_ref,state,total_bytes,token_hash,created_at,expires_at,lease_id,lease_until,ready_at FROM deployments LIMIT 1`,
      )
        .bind(`seed-${index}`, `seed-${index}`)
        .run()
    }
    const response = await start()
    expect(response.status).toBe(429)
    const result = await platform.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM deployments',
    ).first<{ count: number }>()
    expect(result?.count).toBe(count)
  },
)

test.each(["expires_at='invalid'", 'expires_at=1.25', "total_bytes='invalid'"])(
  'given malformed deployment data (%s), when read or replayed, then it is rejected',
  async (update) => {
    const first = await start()
    expect(first.status).toBe(201)
    const receipt = receiptSchema.parse(await first.json())
    await platform.env.DB.prepare(`UPDATE deployments SET ${update}`).run()
    const response = await uploadsApi.request(
      `http://localhost/${receipt.deploymentId}`,
      { headers: { Authorization: `Bearer ${receipt.credential}` } },
      platform.env,
    )
    expect(response.status).toBe(500)
    expect((await start()).status).toBe(500)
  },
)

test('given a stored invalid file size, when the receipt is read, then it is rejected', async () => {
  const first = await start()
  expect(first.status).toBe(201)
  const receipt = receiptSchema.parse(await first.json())
  await platform.env.DB.prepare("UPDATE upload_files SET size='invalid'").run()
  const response = await uploadsApi.request(
    `http://localhost/${receipt.deploymentId}`,
    { headers: { Authorization: `Bearer ${receipt.credential}` } },
    platform.env,
  )
  expect(response.status).toBe(500)
})

test('given configured limits, when an upload starts, then the session records them and later changes do not apply', async () => {
  const configured = {
    ...platform.env,
    UPLOAD_LIMITS: { sessionSeconds: 600, receiveLeaseSeconds: 30 },
  }
  const before = Math.floor(Date.now() / 1000)
  const response = await start(configured)
  expect(response.status).toBe(201)
  const { expiresAt } = z
    .object({ expiresAt: z.number() })
    .parse(await response.json())
  expect(expiresAt - before).toBeGreaterThanOrEqual(600)
  expect(expiresAt - before).toBeLessThanOrEqual(601)
  const replay = await start({
    ...platform.env,
    UPLOAD_LIMITS: { sessionSeconds: 60, receiveLeaseSeconds: 30 },
  })
  expect(
    z.object({ expiresAt: z.number() }).parse(await replay.json()).expiresAt,
  ).toBe(expiresAt)
})

test('given a configured file count limit, when a larger inventory starts, then it is rejected', async () => {
  const response = await uploadsApi.request(
    'http://localhost/',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer local-oidc-token-123456789' },
      body: JSON.stringify({
        entry: 'index.html',
        files: [
          ...inventory.files,
          { path: 'app.js', size: 1, sha256: 'a'.repeat(64) },
        ],
      }),
    },
    { ...platform.env, UPLOAD_LIMITS: { files: 1 } },
  )
  expect(response.status).toBe(400)
})

test.each([{ files: 0 }, { unknown: 1 }, 'invalid'])(
  'given invalid upload limits %j, when an upload starts, then no session is created',
  async (config) => {
    const response = await start({ ...platform.env, UPLOAD_LIMITS: config })
    expect(response.status).toBe(500)
    const result = await platform.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM deployments',
    ).first<{ count: number }>()
    expect(result?.count).toBe(0)
  },
)
