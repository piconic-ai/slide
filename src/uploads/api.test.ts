import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { z } from 'zod'
import { applyMigrations } from '../db/test-migrations'
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
const errorSchema = z.object({ error: z.string(), code: z.string() })
const rejectionSchema = errorSchema.extend({
  reason: z.string().optional(),
  deploymentId: z.string().optional(),
})
const twoFileInventory = {
  entry: 'index.html',
  files: [
    { path: 'index.html', size: 1, sha256: 'a'.repeat(64) },
    { path: 'app.js', size: 2, sha256: 'a'.repeat(64) },
  ],
}
const receiptSchema = z.object({
  deploymentId: z.string(),
  credential: z.string(),
  state: z.enum(['uploading', 'ready', 'failed', 'expired']),
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

beforeAll(() => applyMigrations(platform.env.DB))
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
    `total_bytes=${DEFAULT_UPLOAD_LIMITS.authorBytes}, state='ready', ready_at=1`,
    1,
    'author_bytes_exceeded',
  ],
  [
    'active sessions',
    'total_bytes=0',
    DEFAULT_UPLOAD_LIMITS.activeSessions,
    null,
  ],
  [
    'daily starts',
    "total_bytes=0, state='ready', ready_at=1",
    DEFAULT_UPLOAD_LIMITS.startsPerDay,
    'daily_starts_exceeded',
  ],
])(
  'given the %s quota is reached, when an upload starts, then it is rejected',
  async (_name, update, count, reason) => {
    expect((await start()).status).toBe(201)
    await platform.env.DB.prepare(
      `UPDATE deployments SET idempotency_key='seed', ${update}`,
    ).run()
    for (let index = 1; index < count; index++) {
      await platform.env.DB.prepare(
        `INSERT INTO deployments SELECT ?,?,inventory_digest,source_sha,run_id,run_attempt,actor_id,repository_id,owner_id,source_ref,state,total_bytes,token_hash,created_at,expires_at,credential_expires_at,lease_id,lease_until,ready_at,failure_reason FROM deployments LIMIT 1`,
      )
        .bind(`seed-${index}`, `seed-${index}`)
        .run()
    }
    const response = await start()
    expect(response.status).toBe(reason ? 409 : 429)
    const body = rejectionSchema.parse(await response.json())
    const failed = await platform.env.DB.prepare(
      "SELECT failure_reason AS reason FROM deployments WHERE state = 'failed'",
    ).all<{ reason: string }>()
    if (reason) {
      // Quotas that do not free up within the attempt are recorded for history.
      expect(body).toMatchObject({ code: 'start_rejected', reason })
      expect(failed.results).toEqual([{ reason }])
      expect(body.deploymentId).toEqual(expect.any(String))
      const replay = await start()
      expect(replay.status).toBe(409)
      expect(rejectionSchema.parse(await replay.json())).toMatchObject({
        code: 'session_failed',
        reason,
      })
    } else {
      // Another upload in progress is transient: retry in the same attempt.
      expect(body.code).toBe('upload_busy')
      expect(failed.results).toEqual([])
    }
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

test.each([
  [{ files: 1 }, 'too_many_files'],
  [{ fileBytes: 1 }, 'file_too_large'],
  [{ deploymentBytes: 2, fileBytes: 2 }, 'deployment_too_large'],
])(
  'given configured limits %j, when a larger inventory starts, then the refusal is recorded without reserving quota',
  async (config, reason) => {
    const response = await uploadsApi.request(
      'http://localhost/',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer local-oidc-token-123456789' },
        body: JSON.stringify({
          entry: 'index.html',
          files: [
            ...inventory.files,
            { path: 'app.js', size: 2, sha256: 'a'.repeat(64) },
          ],
        }),
      },
      { ...platform.env, UPLOAD_LIMITS: config },
    )
    expect(response.status).toBe(413)
    const body = rejectionSchema.parse(await response.json())
    expect(body).toMatchObject({ code: 'start_rejected', reason })
    const row = await platform.env.DB.prepare(
      'SELECT id, state, failure_reason, total_bytes FROM deployments',
    ).first()
    expect(row).toEqual({
      id: body.deploymentId,
      state: 'failed',
      failure_reason: reason,
      total_bytes: 3,
    })
    const replay = await uploadsApi.request(
      'http://localhost/',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer local-oidc-token-123456789' },
        body: JSON.stringify(twoFileInventory),
      },
      { ...platform.env, UPLOAD_LIMITS: config },
    )
    expect(replay.status).toBe(409)
    expect(rejectionSchema.parse(await replay.json())).toMatchObject({
      code: 'session_failed',
      reason,
    })
    expect((await start()).status).toBe(201)
  },
)

test.each([{ files: 1 }, { fileBytes: 1 }])(
  'given limits changed to %j after a session started, when it is replayed, then it resumes on its recorded terms',
  async (config) => {
    const twoFiles = (env: Env) =>
      uploadsApi.request(
        'http://localhost/',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer local-oidc-token-123456789' },
          body: JSON.stringify({
            entry: 'index.html',
            files: [
              ...inventory.files,
              { path: 'app.js', size: 2, sha256: 'a'.repeat(64) },
            ],
          }),
        },
        env,
      )
    expect((await twoFiles(platform.env)).status).toBe(201)
    const replay = await twoFiles({ ...platform.env, UPLOAD_LIMITS: config })
    expect(replay.status).toBe(201)
    const result = await platform.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM deployments',
    ).first<{ count: number }>()
    expect(result?.count).toBe(1)
  },
)

test('given a configured receive lease, when a file is being received, then the lease uses it', async () => {
  const receipt = receiptSchema.parse(await (await start()).json())
  const before = Math.floor(Date.now() / 1000)
  let release = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      release = () => {
        controller.enqueue(new Uint8Array([0x61]))
        controller.close()
      }
    },
  })
  const pending = uploadsApi.request(
    `http://localhost/${receipt.deploymentId}/files/0`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${receipt.credential}` },
      body,
      duplex: 'half',
    } as RequestInit,
    { ...platform.env, UPLOAD_LIMITS: { receiveLeaseSeconds: 37 } },
  )
  let lease: { lease_until: number } | null = null
  for (let attempt = 0; attempt < 50 && !lease; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    lease = await platform.env.DB.prepare(
      'SELECT lease_until FROM deployments WHERE lease_id IS NOT NULL',
    ).first<{ lease_until: number }>()
  }
  release()
  await pending
  expect(lease?.lease_until).toBeGreaterThanOrEqual(before + 37)
  expect(lease?.lease_until).toBeLessThanOrEqual(before + 38)
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

test('given invalid upload limits and no credential, when an upload starts, then authentication fails first', async () => {
  const response = await uploadsApi.request(
    'http://localhost/',
    { method: 'POST', body: JSON.stringify(inventory) },
    { ...platform.env, UPLOAD_LIMITS: { files: 0 } },
  )
  expect(response.status).toBe(401)
})

test('given invalid upload limits, when an existing session is replayed, then its credential is kept', async () => {
  const receipt = receiptSchema.parse(await (await start()).json())
  const replay = await start({ ...platform.env, UPLOAD_LIMITS: { files: 0 } })
  expect(replay.status).toBe(500)
  const status = await uploadsApi.request(
    `http://localhost/${receipt.deploymentId}`,
    { headers: { Authorization: `Bearer ${receipt.credential}` } },
    platform.env,
  )
  expect(status.status).toBe(200)
})

const readReceipt = (id: string, credential: string) =>
  uploadsApi.request(
    `http://localhost/${id}`,
    { headers: { Authorization: `Bearer ${credential}` } },
    platform.env,
  )

test('given an expired credential in an open session, when the uploader re-authenticates, then the same session gets a fresh credential', async () => {
  const receipt = receiptSchema.parse(await (await start()).json())
  await platform.env.DB.prepare(
    'UPDATE deployments SET credential_expires_at = 1',
  ).run()
  const expired = await readReceipt(receipt.deploymentId, receipt.credential)
  expect(expired.status).toBe(401)
  expect(errorSchema.parse(await expired.json()).code).toBe(
    'credential_expired',
  )
  const replay = await start()
  expect(replay.status).toBe(201)
  const renewed = receiptSchema.parse(await replay.json())
  expect(renewed.deploymentId).toBe(receipt.deploymentId)
  expect(
    (await readReceipt(renewed.deploymentId, renewed.credential)).status,
  ).toBe(200)
  const row = await platform.env.DB.prepare(
    'SELECT COUNT(*) AS count, MAX(credential_expires_at <= expires_at) AS bounded FROM deployments',
  ).first<{ count: number; bounded: number }>()
  expect(row).toEqual({ count: 1, bounded: 1 })
})

test.each([
  ['expired session time', 'expires_at = 1', 409, 'session_expired'],
  ['expired state', "state = 'expired'", 409, 'session_expired'],
])(
  'given an %s, when the credential is used or replayed, then a new attempt is required',
  async (_name, update, status, code) => {
    const receipt = receiptSchema.parse(await (await start()).json())
    await platform.env.DB.prepare(`UPDATE deployments SET ${update}`).run()
    const used = await readReceipt(receipt.deploymentId, receipt.credential)
    expect(used.status).toBe(status)
    expect(errorSchema.parse(await used.json()).code).toBe(code)
    const replay = await start()
    expect(replay.status).toBe(409)
    expect(errorSchema.parse(await replay.json()).code).toBe(code)
  },
)

test('given a failed session, when replayed, then it is not resumed', async () => {
  const receipt = receiptSchema.parse(await (await start()).json())
  await platform.env.DB.prepare(
    "UPDATE deployments SET state = 'failed', failure_reason = 'test'",
  ).run()
  const replay = await start()
  expect(replay.status).toBe(409)
  expect(errorSchema.parse(await replay.json()).code).toBe('session_failed')
  const status = await readReceipt(receipt.deploymentId, receipt.credential)
  expect(status.status).toBe(200)
  expect(await status.json()).toMatchObject({
    state: 'failed',
    failureReason: 'test',
  })
  const auth = { Authorization: `Bearer ${receipt.credential}` }
  for (const [path, method] of [
    ['files/0', 'PUT'],
    ['finalize', 'POST'],
  ]) {
    const response = await uploadsApi.request(
      `http://localhost/${receipt.deploymentId}/${path}`,
      { method, headers: auth, body: 'a' },
      platform.env,
    )
    expect(response.status).toBe(409)
    expect(rejectionSchema.parse(await response.json())).toMatchObject({
      code: 'session_failed',
      reason: 'test',
    })
  }
})

test('given expired and failed sessions, when an upload starts, then they reserve no bytes', async () => {
  expect((await start()).status).toBe(201)
  await platform.env.DB.prepare(
    `UPDATE deployments SET idempotency_key = 'seed', state = 'failed', failure_reason = 'test', total_bytes = ${DEFAULT_UPLOAD_LIMITS.authorBytes}`,
  ).run()
  expect((await start()).status).toBe(201)
})

test('given an expired credential, when a file is sent, then re-authentication is requested', async () => {
  const receipt = receiptSchema.parse(await (await start()).json())
  await platform.env.DB.prepare(
    'UPDATE deployments SET credential_expires_at = 1',
  ).run()
  const response = await uploadsApi.request(
    `http://localhost/${receipt.deploymentId}/files/0`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${receipt.credential}` },
      body: 'a',
    },
    platform.env,
  )
  expect(response.status).toBe(401)
  expect(errorSchema.parse(await response.json()).code).toBe(
    'credential_expired',
  )
})

test('given a session shorter than the credential lifetime, when it starts, then the credential ends with the session', async () => {
  const response = await start({
    ...platform.env,
    UPLOAD_LIMITS: { sessionSeconds: 600, credentialSeconds: 3600 },
  })
  expect(response.status).toBe(201)
  const body = z
    .object({ expiresAt: z.number(), credentialExpiresAt: z.number() })
    .parse(await response.json())
  expect(body.credentialExpiresAt).toBe(body.expiresAt)
  const row = await platform.env.DB.prepare(
    'SELECT credential_expires_at = expires_at AS same FROM deployments',
  ).first<{ same: number }>()
  expect(row?.same).toBe(1)
})

test('given concurrent replays, when both rotate the credential, then exactly one returned credential stays valid', async () => {
  const receipt = receiptSchema.parse(await (await start()).json())
  const replays = await Promise.all([start(), start()])
  const statuses = replays.map((response) => response.status)
  expect(statuses.every((status) => status === 201 || status === 409)).toBe(
    true,
  )
  for (const response of replays.filter(({ status }) => status === 409))
    expect(errorSchema.parse(await response.json()).code).toBe(
      'session_changed',
    )
  const credentials = await Promise.all(
    replays
      .filter((response) => response.status === 201)
      .map(async (response) => receiptSchema.parse(await response.json())),
  )
  const valid = await Promise.all(
    credentials.map(
      async ({ credential }) =>
        (await readReceipt(receipt.deploymentId, credential)).status === 200,
    ),
  )
  expect(valid.filter(Boolean)).toHaveLength(1)
})

test('given a session that expires while a file is received, when the receipt is stored, then the terminal code is returned', async () => {
  const receipt = receiptSchema.parse(await (await start()).json())
  await platform.env.DB.prepare('UPDATE upload_files SET sha256 = ?')
    .bind('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb')
    .run()
  let release = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      release = () => {
        controller.enqueue(new Uint8Array([0x61]))
        controller.close()
      }
    },
  })
  const pending = uploadsApi.request(
    `http://localhost/${receipt.deploymentId}/files/0`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${receipt.credential}` },
      body,
      duplex: 'half',
    } as RequestInit,
    platform.env,
  )
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    const leased = await platform.env.DB.prepare(
      'SELECT 1 FROM deployments WHERE lease_id IS NOT NULL',
    ).first()
    if (leased) break
  }
  await platform.env.DB.prepare('UPDATE deployments SET expires_at = 1').run()
  release()
  const response = await pending
  expect(response.status).toBe(409)
  expect(errorSchema.parse(await response.json()).code).toBe('session_expired')
  const file = await platform.env.DB.prepare(
    'SELECT object_key FROM upload_files',
  ).first<{ object_key: string | null }>()
  expect(file?.object_key).toBeNull()
})

test('given an open session with a receive in progress, when finalize is refused, then the conflict stays retryable', async () => {
  const { finalize } = await receivedSession()
  await platform.env.DB.prepare(
    "UPDATE deployments SET lease_id = 'busy', lease_until = 9999999999",
  ).run()
  const busy = await finalize()
  expect(busy.status).toBe(409)
  expect(await busy.json()).toEqual({
    error: 'Upload is in progress; retry finalize',
  })
})

test('given refused starts in the window, when an upload starts, then they do not consume the start quota', async () => {
  const limits = { ...platform.env, UPLOAD_LIMITS: { startsPerDay: 1 } }
  const tooLarge = () =>
    uploadsApi.request(
      'http://localhost/',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer local-oidc-token-123456789' },
        body: JSON.stringify({
          entry: 'index.html',
          files: [{ path: 'index.html', size: 2, sha256: 'a'.repeat(64) }],
        }),
      },
      { ...platform.env, UPLOAD_LIMITS: { startsPerDay: 1, fileBytes: 1 } },
    )
  expect((await tooLarge()).status).toBe(413)
  expect((await start(limits)).status).toBe(201)
})

const oversized = (sha256: string) =>
  uploadsApi.request(
    'http://localhost/',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer local-oidc-token-123456789' },
      body: JSON.stringify({
        entry: 'index.html',
        files: [{ path: 'index.html', size: 2, sha256 }],
      }),
    },
    {
      ...platform.env,
      UPLOAD_LIMITS: { fileBytes: 1, refusalsPerDay: 2 },
    },
  )

test('given the refusal cap is reached, when more distinct inventories are refused, then refusals are reported but not recorded', async () => {
  const responses = []
  for (const digit of ['1', '2', '3'])
    responses.push(await oversized(digit.repeat(64)))
  expect(responses.map((response) => response.status)).toEqual([413, 413, 413])
  const bodies = await Promise.all(
    responses.map(async (response) =>
      rejectionSchema.parse(await response.json()),
    ),
  )
  expect(bodies.map((body) => body.reason)).toEqual([
    'file_too_large',
    'file_too_large',
    'file_too_large',
  ])
  expect(bodies.map((body) => body.deploymentId !== undefined)).toEqual([
    true,
    true,
    false,
  ])
  const rows = await platform.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM deployments',
  ).first<{ count: number }>()
  expect(rows?.count).toBe(2)
})

test('given a large refused inventory and a tight author quota, when an upload starts, then the refusal reserves nothing', async () => {
  const limits = { authorBytes: 2, deploymentBytes: 2, fileBytes: 2 }
  const refused = await uploadsApi.request(
    'http://localhost/',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer local-oidc-token-123456789' },
      body: JSON.stringify(twoFileInventory),
    },
    { ...platform.env, UPLOAD_LIMITS: limits },
  )
  expect(refused.status).toBe(413)
  expect((await start({ ...platform.env, UPLOAD_LIMITS: limits })).status).toBe(
    201,
  )
})

test('given concurrent starts of the same attempt at the start quota, when they race, then neither is recorded as a refusal', async () => {
  const limited = { ...platform.env, UPLOAD_LIMITS: { startsPerDay: 1 } }
  const responses = await Promise.all([start(limited), start(limited)])
  for (const response of responses) {
    expect([201, 429]).toContain(response.status)
    if (response.status === 429)
      expect(errorSchema.parse(await response.json()).code).toBe('upload_busy')
  }
  const failed = await platform.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM deployments WHERE state = 'failed'",
  ).first<{ count: number }>()
  expect(failed?.count).toBe(0)
})

test('given bytes reserved by an open session, when another start would exceed the author quota, then it waits instead of failing', async () => {
  const limits = {
    ...platform.env,
    UPLOAD_LIMITS: {
      activeSessions: 2,
      authorBytes: 3,
      deploymentBytes: 3,
      fileBytes: 3,
    },
  }
  expect((await start(limits)).status).toBe(201)
  const response = await uploadsApi.request(
    'http://localhost/',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer local-oidc-token-123456789' },
      body: JSON.stringify(twoFileInventory),
    },
    limits,
  )
  expect(response.status).toBe(429)
  expect(errorSchema.parse(await response.json()).code).toBe('upload_busy')
  const failed = await platform.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM deployments WHERE state = 'failed'",
  ).first<{ count: number }>()
  expect(failed?.count).toBe(0)
})

test('given an inventory whose total exceeds the safe integer range, when it starts twice, then it is rejected without a record', async () => {
  const oversized = () =>
    uploadsApi.request(
      'http://localhost/',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer local-oidc-token-123456789' },
        body: JSON.stringify({
          entry: 'index.html',
          files: [
            {
              path: 'index.html',
              size: Number.MAX_SAFE_INTEGER,
              sha256: 'a'.repeat(64),
            },
            { path: 'app.js', size: 1, sha256: 'a'.repeat(64) },
          ],
        }),
      },
      platform.env,
    )
  expect((await oversized()).status).toBe(400)
  expect((await oversized()).status).toBe(400)
  const rows = await platform.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM deployments',
  ).first<{ count: number }>()
  expect(rows?.count).toBe(0)
})

const contentHash =
  'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'
async function receivedSession() {
  const receipt = receiptSchema.parse(await (await start()).json())
  await platform.env.DB.prepare('UPDATE upload_files SET sha256 = ?')
    .bind(contentHash)
    .run()
  const auth = { Authorization: `Bearer ${receipt.credential}` }
  const put = await uploadsApi.request(
    `http://localhost/${receipt.deploymentId}/files/0`,
    { method: 'PUT', headers: auth, body: 'a' },
    platform.env,
  )
  expect(put.status).toBe(200)
  const finalize = () =>
    uploadsApi.request(
      `http://localhost/${receipt.deploymentId}/finalize`,
      { method: 'POST', headers: auth },
      platform.env,
    )
  const objectKey = async () =>
    (
      await platform.env.DB.prepare(
        'SELECT object_key FROM upload_files',
      ).first<{ object_key: string | null }>()
    )?.object_key ?? null
  return { receipt, auth, finalize, objectKey }
}

test.each([
  ['deleted', (key: string) => platform.env.UPLOADS.delete(key)],
  [
    'stored without a checksum',
    (key: string) => platform.env.UPLOADS.put(key, 'a').then(() => undefined),
  ],
  [
    'replaced with other bytes',
    (key: string) => platform.env.UPLOADS.put(key, 'b').then(() => undefined),
  ],
])(
  'given a received object that was %s, when finalize runs, then the file is listed for resend and can be received again',
  async (_name, damage) => {
    const { receipt, auth, finalize, objectKey } = await receivedSession()
    const key = await objectKey()
    if (!key) throw new Error('expected a received object')
    await damage(key)
    const refused = await finalize()
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({
      code: 'files_missing',
      missing: ['index.html'],
    })
    expect(await objectKey()).toBeNull()
    // The unverified object is removed rather than left unreferenced.
    expect(await platform.env.UPLOADS.head(key)).toBeNull()
    const resend = await uploadsApi.request(
      `http://localhost/${receipt.deploymentId}/files/0`,
      { method: 'PUT', headers: auth, body: 'a' },
      platform.env,
    )
    expect(resend.status).toBe(200)
    expect((await finalize()).status).toBe(200)
  },
)

test('given verified objects, when finalize runs twice, then it becomes ready once and returns the same result', async () => {
  const { finalize } = await receivedSession()
  const first = await finalize()
  expect(first.status).toBe(200)
  expect(await first.json()).toMatchObject({ state: 'ready' })
  const again = await finalize()
  expect(again.status).toBe(200)
  expect(await again.json()).toMatchObject({ state: 'ready' })
})

test('given another finalize makes the deployment ready during verification, when an object looks missing, then the ready file map is kept', async () => {
  const { receipt, auth, objectKey } = await receivedSession()
  const key = await objectKey()
  if (!key) throw new Error('expected a received object')
  const bucket = platform.env.UPLOADS
  // The concurrent finalize wins while this one is checking R2, and the object
  // then reads as missing.
  const racingBucket = {
    head: async () => {
      await platform.env.DB.prepare(
        "UPDATE deployments SET state = 'ready', ready_at = 1",
      ).run()
      return null
    },
  } as unknown as R2Bucket
  const response = await uploadsApi.request(
    `http://localhost/${receipt.deploymentId}/finalize`,
    { method: 'POST', headers: auth },
    { ...platform.env, UPLOADS: racingBucket },
  )
  // The winner's ready deployment is reported, not a missing file.
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ state: 'ready' })
  expect(await objectKey()).toBe(key)
  expect(await bucket.head(key)).not.toBeNull()
})

test('given storage fails while verifying, when finalize runs, then it asks for a retry and keeps receipts', async () => {
  const { receipt, auth, objectKey } = await receivedSession()
  const key = await objectKey()
  const failingBucket = {
    head: () => Promise.reject(new Error('R2 unavailable')),
  } as unknown as R2Bucket
  const response = await uploadsApi.request(
    `http://localhost/${receipt.deploymentId}/finalize`,
    { method: 'POST', headers: auth },
    { ...platform.env, UPLOADS: failingBucket },
  )
  expect(response.status).toBe(429)
  expect(errorSchema.parse(await response.json()).code).toBe('upload_busy')
  expect(await objectKey()).toBe(key)
})
