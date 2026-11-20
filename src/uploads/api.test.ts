import { count, eq, isNotNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { getPlatformProxy } from 'wrangler'
import { z } from 'zod'
import {
  decks,
  deployments,
  pageScriptDeployments,
  suspensions,
  uploadFiles,
} from '../db/schema'
import { applyMigrations } from '../db/test-migrations'
import {
  INVITED_ID,
  OWNER_ID,
  signIn,
  testEnv,
  withInvited,
} from '../publication/test-support'
import { deckUploadsApi as startApi, startUpload, uploadsApi } from './api'
import { parseInventoryStructure } from './inventory'
import { attemptSchema } from './start-request'
import { deckIdSchema, deckSlugSchema } from '../decks/binding'
import { DEFAULT_UPLOAD_LIMITS } from './limits'

const platform = await getPlatformProxy<Env>({ persist: false })
const db = drizzle(platform.env.DB)
/** The author's session cookie, set once the migrations are applied. */
let session = ''
const sha256Hex = async (text: string) =>
  Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  ).toString('hex')
/**
 * A start body as the author's browser sends it. A body that names no
 * attempt gets one made from its bytes, so sending the same body again
 * continues the same attempt and another inventory is another attempt.
 */
async function withAttempt(body: unknown) {
  if (typeof body !== 'string') return body
  try {
    const json = JSON.parse(body) as Record<string, unknown>
    if (typeof json !== 'object' || json === null || 'attempt' in json)
      return body
    return JSON.stringify({ attempt: await sha256Hex(body), ...json })
  } catch {
    return body
  }
}
/** Starts as the signed-in author, from the service's own origin. */
const deckUploadsApi = {
  request: async (
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
    env: Env,
  ) =>
    startApi.request(
      url,
      {
        ...init,
        headers: {
          Cookie: session,
          Origin: new URL(url).origin,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        body: (await withAttempt(init.body)) as string,
      },
      testEnv(env),
    ),
}
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
  files: z.array(
    z.object({ id: z.string(), path: z.string(), received: z.boolean() }),
  ),
})
const start = (env: Env = platform.env) =>
  deckUploadsApi.request(
    'http://localhost/talk/uploads',
    {
      method: 'POST',
      body: JSON.stringify(inventory),
    },
    env,
  )

beforeAll(async () => {
  await applyMigrations(platform.env.DB)
  session = await signIn(testEnv(platform.env))
})
const addDeck = (deck: string, owner = OWNER_ID, slug = deck) =>
  db
    .insert(decks)
    .values({ id: deck, slug, owner_user_id: owner, created_at: 1 })
    .onConflictDoNothing()
beforeEach(async () => {
  await db.batch([
    // Decks and deployments reference each other, so pointers go first.
    db
      .update(decks)
      .set({ public_deployment_id: null, resume_deployment_id: null }),
    db.delete(uploadFiles),
    db.delete(deployments),
    db.delete(decks),
  ])
  await addDeck('talk')
})
afterAll(() => platform.dispose())

test('given an interrupted upload, when replayed, then credentials rotate and the file map is repaired', async () => {
  const first = await start()
  expect(first.status).toBe(201)
  const receipt = receiptSchema.parse(await first.json())
  expect(receipt).toMatchObject({
    state: 'uploading',
    files: [{ id: '0', path: 'index.html', received: false }],
  })
  await db.delete(uploadFiles)
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

test.each<
  [string, Partial<typeof deployments.$inferInsert>, number, string | null]
>([
  [
    'total bytes',
    {
      total_bytes: DEFAULT_UPLOAD_LIMITS.authorBytes,
      state: 'ready',
      ready_at: 1,
    },
    1,
    'author_bytes_exceeded',
  ],
  [
    'active sessions',
    // In the middle of receiving a file, so a new start does not replace it.
    { total_bytes: 0, lease_id: 'receiving', lease_until: 9999999999 },
    DEFAULT_UPLOAD_LIMITS.activeSessions,
    null,
  ],
  [
    'daily starts',
    {
      total_bytes: 0,
      state: 'ready',
      ready_at: 1,
    },
    DEFAULT_UPLOAD_LIMITS.startsPerDay,
    'daily_starts_exceeded',
  ],
])(
  'given the %s quota is reached, when an upload starts, then it is rejected',
  async (_name, update, count, reason) => {
    expect((await start()).status).toBe(201)
    await db.update(deployments).set({ idempotency_key: 'seed', ...update })
    const seed = await db.select().from(deployments).limit(1).get()
    if (!seed) throw new Error('expected a seeded deployment')
    for (let index = 1; index < count; index++) {
      await db.insert(deployments).values({
        ...seed,
        id: `seed-${index}`,
        idempotency_key: `seed-${index}`,
      })
    }
    const response = await start()
    expect(response.status).toBe(reason ? 409 : 429)
    const body = rejectionSchema.parse(await response.json())
    const failed = await db
      .select({ reason: deployments.failure_reason })
      .from(deployments)
      .where(eq(deployments.state, 'failed'))
      .all()
    if (reason) {
      // Quotas that do not free up within the attempt are recorded for history.
      expect(body).toMatchObject({ code: 'start_rejected', reason })
      expect(failed).toEqual([{ reason }])
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
      expect(failed).toEqual([])
    }
  },
)

test.each(["expires_at='invalid'", 'expires_at=1.25', "total_bytes='invalid'"])(
  'given malformed deployment data (%s), when read or replayed, then it is rejected',
  async (update) => {
    const first = await start()
    expect(first.status).toBe(201)
    const receipt = receiptSchema.parse(await first.json())
    await db.run(sql`UPDATE ${deployments} SET ${sql.raw(update)}`)
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
  await db.update(uploadFiles).set({ size: sql`'invalid'` })
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
    const response = await deckUploadsApi.request(
      'http://localhost/talk/uploads',
      {
        method: 'POST',
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
    const row = await db
      .select({
        id: deployments.id,
        state: deployments.state,
        failure_reason: deployments.failure_reason,
        total_bytes: deployments.total_bytes,
        swept: sql<number>`${deployments.swept_at} IS NOT NULL`,
      })
      .from(deployments)
      .get()
    expect(row).toEqual({
      id: body.deploymentId,
      state: 'failed',
      failure_reason: reason,
      total_bytes: 3,
      // A refusal never stores objects, so cleanup never needs to visit it.
      swept: 1,
    })
    const replay = await deckUploadsApi.request(
      'http://localhost/talk/uploads',
      {
        method: 'POST',
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
      deckUploadsApi.request(
        'http://localhost/talk/uploads',
        {
          method: 'POST',
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
    const result = await db.select({ count: count() }).from(deployments).get()
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
  let lease: { lease_until: number | null } | null = null
  for (let attempt = 0; attempt < 50 && !lease; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    lease =
      (await db
        .select({ lease_until: deployments.lease_until })
        .from(deployments)
        .where(isNotNull(deployments.lease_id))
        .get()) ?? null
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
    const result = await db.select({ count: count() }).from(deployments).get()
    expect(result?.count).toBe(0)
  },
)

test('given invalid upload limits and no session, when an upload starts, then authentication fails first', async () => {
  const response = await deckUploadsApi.request(
    'http://localhost/talk/uploads',
    {
      method: 'POST',
      headers: { Cookie: '' },
      body: JSON.stringify(inventory),
    },
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
  await db.update(deployments).set({ credential_expires_at: 1 })
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
  const row = await db
    .select({
      count: count(),
      bounded: sql<number>`MAX(${deployments.credential_expires_at} <= ${deployments.expires_at})`,
    })
    .from(deployments)
    .get()
  expect(row).toEqual({ count: 1, bounded: 1 })
})

test.each<[string, Partial<typeof deployments.$inferInsert>, number, string]>([
  ['expired session time', { expires_at: 1 }, 409, 'session_expired'],
  ['expired state', { state: 'expired' }, 409, 'session_expired'],
])(
  'given an %s, when the credential is used or replayed, then a new attempt is required',
  async (_name, update, status, code) => {
    const receipt = receiptSchema.parse(await (await start()).json())
    await db.update(deployments).set(update)
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
  await db.update(deployments).set({ state: 'failed', failure_reason: 'test' })
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
  await db.update(deployments).set({
    idempotency_key: 'seed',
    state: 'failed',
    failure_reason: 'test',
    total_bytes: DEFAULT_UPLOAD_LIMITS.authorBytes,
  })
  expect((await start()).status).toBe(201)
})

test('given an expired credential, when a file is sent, then re-authentication is requested', async () => {
  const receipt = receiptSchema.parse(await (await start()).json())
  await db.update(deployments).set({ credential_expires_at: 1 })
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
  const row = await db
    .select({
      same: sql<number>`${deployments.credential_expires_at} = ${deployments.expires_at}`,
    })
    .from(deployments)
    .get()
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
  await db.update(uploadFiles).set({
    sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
  })
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
    const leased = await db
      .select({ id: deployments.id })
      .from(deployments)
      .where(isNotNull(deployments.lease_id))
      .get()
    if (leased) break
  }
  await db.update(deployments).set({ expires_at: 1 })
  release()
  const response = await pending
  expect(response.status).toBe(409)
  expect(errorSchema.parse(await response.json()).code).toBe('session_expired')
  const file = await db
    .select({ object_key: uploadFiles.object_key })
    .from(uploadFiles)
    .get()
  expect(file?.object_key).toBeNull()
})

test('given an open session with a receive in progress, when finalize is refused, then the conflict stays retryable', async () => {
  const { finalize } = await receivedSession()
  await db
    .update(deployments)
    .set({ lease_id: 'busy', lease_until: 9999999999 })
  const busy = await finalize()
  expect(busy.status).toBe(409)
  expect(await busy.json()).toEqual({
    error: 'Upload is in progress; retry finalize',
  })
})

test('given refused starts in the window, when an upload starts, then they do not consume the start quota', async () => {
  const limits = { ...platform.env, UPLOAD_LIMITS: { startsPerDay: 1 } }
  const tooLarge = () =>
    deckUploadsApi.request(
      'http://localhost/talk/uploads',
      {
        method: 'POST',
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
  deckUploadsApi.request(
    'http://localhost/talk/uploads',
    {
      method: 'POST',
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
  const rows = await db.select({ count: count() }).from(deployments).get()
  expect(rows?.count).toBe(2)
})

test('given a large refused inventory and a tight author quota, when an upload starts, then the refusal reserves nothing', async () => {
  const limits = { authorBytes: 2, deploymentBytes: 2, fileBytes: 2 }
  const refused = await deckUploadsApi.request(
    'http://localhost/talk/uploads',
    {
      method: 'POST',
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
  const failed = await db
    .select({ count: count() })
    .from(deployments)
    .where(eq(deployments.state, 'failed'))
    .get()
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
  // The open session is receiving a file, so a new start does not replace it.
  await db
    .update(deployments)
    .set({ lease_id: 'receiving', lease_until: 9999999999 })
  const response = await deckUploadsApi.request(
    'http://localhost/talk/uploads',
    {
      method: 'POST',
      body: JSON.stringify(twoFileInventory),
    },
    limits,
  )
  expect(response.status).toBe(429)
  expect(errorSchema.parse(await response.json()).code).toBe('upload_busy')
  const failed = await db
    .select({ count: count() })
    .from(deployments)
    .where(eq(deployments.state, 'failed'))
    .get()
  expect(failed?.count).toBe(0)
})

test('given an inventory whose total exceeds the safe integer range, when it starts twice, then it is rejected without a record', async () => {
  const oversized = () =>
    deckUploadsApi.request(
      'http://localhost/talk/uploads',
      {
        method: 'POST',
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
  const rows = await db.select({ count: count() }).from(deployments).get()
  expect(rows?.count).toBe(0)
})

const contentHash =
  'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'
async function receivedSession(body = 'a') {
  const receipt = receiptSchema.parse(await (await start()).json())
  const hash =
    body === 'a'
      ? contentHash
      : Buffer.from(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)),
        ).toString('hex')
  await db
    .update(uploadFiles)
    .set({ sha256: hash, size: new TextEncoder().encode(body).length })
  const auth = { Authorization: `Bearer ${receipt.credential}` }
  const put = await uploadsApi.request(
    `http://localhost/${receipt.deploymentId}/files/0`,
    { method: 'PUT', headers: auth, body },
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
      await db
        .select({ object_key: uploadFiles.object_key })
        .from(uploadFiles)
        .get()
    )?.object_key ?? null
  return { receipt, auth, finalize, objectKey }
}

const publication = () =>
  db
    .select({
      public: decks.public_deployment_id,
      resume: decks.resume_deployment_id,
      paused: decks.paused_at,
      revision: decks.revision,
    })
    .from(decks)
    .where(eq(decks.id, 'talk'))
    .get()
test('F22-AC20: Given a public slide, When a new version is received, resent and made ready, Then the public version and the publication revision stay as they were', async () => {
  const earlier = receiptSchema.parse(await (await start()).json())
  await db.batch([
    db.delete(uploadFiles),
    db
      .update(deployments)
      .set({ state: 'ready', ready_at: 1, idempotency_key: 'earlier' }),
    db
      .update(decks)
      .set({ public_deployment_id: earlier.deploymentId, revision: 3 }),
  ])
  const before = await publication()
  const { receipt, finalize } = await receivedSession()
  expect(receipt.deploymentId).not.toBe(earlier.deploymentId)
  expect(await publication()).toEqual(before)

  const ready = await finalize()
  expect(ready.status).toBe(200)
  expect(await ready.json()).toMatchObject({ state: 'ready' })
  expect(await publication()).toEqual(before)

  // A resent start and a resent finalize change nothing either.
  expect((await start()).status).toBe(201)
  expect((await finalize()).status).toBe(401)
  expect(await publication()).toEqual(before)
})

test('F22-AC20: Given a public slide, When finalizing a new version fails for a missing file, Then the public version stays as it was', async () => {
  const earlier = receiptSchema.parse(await (await start()).json())
  await db.batch([
    db.delete(uploadFiles),
    db
      .update(deployments)
      .set({ state: 'ready', ready_at: 1, idempotency_key: 'earlier' }),
    db.update(decks).set({ public_deployment_id: earlier.deploymentId }),
  ])
  const before = await publication()
  const receipt = receiptSchema.parse(await (await start()).json())
  const refused = await uploadsApi.request(
    `http://localhost/${receipt.deploymentId}/finalize`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${receipt.credential}` },
    },
    platform.env,
  )

  expect(refused.status).toBe(409)
  expect(await refused.json()).toMatchObject({ code: 'files_missing' })
  expect(await publication()).toEqual(before)
})

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

test.each([
  ['<!doctype html><title>Good &amp; talk</title>', 'Good & talk'],
  ['<!doctype html><h1>No title</h1>', null],
])(
  'given index.html %j, when finalize makes it ready, then the title %j is stored',
  async (body, title) => {
    const { receipt, finalize } = await receivedSession(body)
    expect((await finalize()).status).toBe(200)
    const row = await db
      .select({ title: deployments.title })
      .from(deployments)
      .where(eq(deployments.id, receipt.deploymentId))
      .get()
    expect(row?.title).toBe(title)
  },
)

test.each([
  [
    '<!doctype html><title>T</title><meta name="description" content="Six &amp; more">',
    'Six & more',
  ],
  ['<!doctype html><title>T</title>', null],
])(
  'given index.html %j, when finalize makes it ready, then the description %j is stored',
  async (body, description) => {
    const { receipt, finalize } = await receivedSession(body)
    expect((await finalize()).status).toBe(200)
    const row = await db
      .select({ description: deployments.description })
      .from(deployments)
      .where(eq(deployments.id, receipt.deploymentId))
      .get()
    expect(row?.description).toBe(description)
  },
)

const WITH_COVER =
  '<!doctype html><title>T</title><meta property="og:image" content="cover.png">'
const coverPathAfterFinalize = async (addCover: boolean) => {
  const { receipt, finalize } = await receivedSession(WITH_COVER)
  if (addCover) {
    // The same verified object stands in for the image file.
    const [entry] = await db.select().from(uploadFiles)
    await db.insert(uploadFiles).values({
      ...entry!,
      id: '1',
      path: 'cover.png',
      media_type: 'image/png',
    })
  }
  expect((await finalize()).status).toBe(200)
  const row = await db
    .select({ cover: deployments.cover_path })
    .from(deployments)
    .where(eq(deployments.id, receipt.deploymentId))
    .get()
  return row?.cover
}

test('given index.html names an uploaded image in og:image, when finalize makes it ready, then the cover path is stored', async () => {
  expect(await coverPathAfterFinalize(true)).toBe('cover.png')
})

test('given index.html names a file the deployment lacks in og:image, when finalize makes it ready, then no cover is stored', async () => {
  expect(await coverPathAfterFinalize(false)).toBeNull()
})

test.each([
  [
    'loads the page script',
    '<head><script src="/_preview/pages.js"></script>',
    1,
  ],
  ['loads no page script', '<!doctype html><title>T</title>', 0],
])(
  'given index.html %s, when finalize makes it ready, then that is noted for its page images',
  async (_case, html, noted) => {
    const { receipt, finalize } = await receivedSession(html)

    expect((await finalize()).status).toBe(200)

    const rows = await db.select().from(pageScriptDeployments)
    expect(rows).toHaveLength(noted)
    if (noted) expect(rows[0]?.deployment_id).toBe(receipt.deploymentId)
  },
)

test('given another finalize makes the deployment ready during verification, when an object looks missing, then the ready file map is kept', async () => {
  const { receipt, auth, objectKey } = await receivedSession()
  const key = await objectKey()
  if (!key) throw new Error('expected a received object')
  const bucket = platform.env.UPLOADS
  // The concurrent finalize wins while this one is checking R2, and the object
  // then reads as missing.
  const racingBucket = {
    head: async () => {
      await db.update(deployments).set({
        state: 'ready',
        ready_at: 1,
      })
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

const startDeck = (deck: string, env: Env = platform.env) =>
  deckUploadsApi.request(
    `http://localhost/${deck}/uploads`,
    {
      method: 'POST',
      body: JSON.stringify(inventory),
    },
    env,
  )
const countDeployments = async () =>
  (await db.select({ count: count() }).from(deployments).get())?.count

test.each([
  ['a slug the author has no slide for', 'other'],
  ['an invalid slug', 'Not_A_Deck'],
])(
  'given %s, when an upload starts, then nothing is created',
  async (_n, deck) => {
    expect((await startDeck(deck)).status).toBe(404)
    expect(await countDeployments()).toBe(0)
  },
)

const readStatus = (receipt: { deploymentId: string; credential: string }) =>
  uploadsApi.request(
    `http://localhost/${receipt.deploymentId}`,
    { headers: { Authorization: `Bearer ${receipt.credential}` } },
    platform.env,
  )
const bothAuthors = withInvited(platform.env)
/** Starts as the invited author, who signs in on first use. */
let invitedSession = ''
const startAsInvited = async (deck = 'talk') => {
  invitedSession ||= await signIn(testEnv(bothAuthors), 'bob', {
    id: INVITED_ID,
  })
  return deckUploadsApi.request(
    `http://localhost/${deck}/uploads`,
    {
      method: 'POST',
      headers: { Cookie: invitedSession },
      body: JSON.stringify(inventory),
    },
    bothAuthors,
  )
}

test('F22-AC17: Given a slide of another author, When a signed-in author starts an upload to its slug, Then it looks like no slide and nothing is created', async () => {
  const response = await startAsInvited()

  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'Unknown slide' })
  expect(await countDeployments()).toBe(0)
})

test.each([
  ['no cookie', { Cookie: '' }],
  ['a cookie that names no session', { Cookie: '__Host-slide_owner=forged' }],
])(
  'F22-AC17: Given %s, When an upload starts, Then it is refused and nothing is created',
  async (_name, headers) => {
    const response = await deckUploadsApi.request(
      'http://localhost/talk/uploads',
      { method: 'POST', headers, body: JSON.stringify(inventory) },
      platform.env,
    )

    expect(response.status).toBe(401)
    expect(await countDeployments()).toBe(0)
  },
)

test.each([
  ['GET', ''],
  ['PUT', '/files/0'],
  ['POST', '/finalize'],
  ['GET', '/content/index.html'],
])(
  'F22-AC17: Given an upload in progress, When %s %s is sent without its credential, Then it is refused',
  async (method, path) => {
    const receipt = receiptSchema.parse(await (await start()).json())
    const send = (headers: Record<string, string>) =>
      uploadsApi.request(
        `http://localhost/${receipt.deploymentId}${path}`,
        { method, headers },
        platform.env,
      )

    // The author's session alone does not stand in for the credential.
    expect((await send({ Cookie: session })).status).toBe(401)
    expect(
      (await send({ Authorization: `Bearer ${'x'.repeat(40)}` })).status,
    ).toBe(401)
  },
)

test('F22-AC18: Given a GitHub Actions OIDC token and no session, When an upload starts, Then it is refused and nothing is created', async () => {
  const response = await deckUploadsApi.request(
    'http://localhost/talk/uploads',
    {
      method: 'POST',
      headers: {
        Cookie: '',
        Authorization: `Bearer eyJhbGciOiJSUzI1NiJ9.${'a'.repeat(40)}.sig`,
      },
      body: JSON.stringify(inventory),
    },
    platform.env,
  )

  expect(response.status).toBe(401)
  expect(await countDeployments()).toBe(0)
})

test.each([
  ['a form another site submits', 'application/x-www-form-urlencoded', 403],
  ['plain text another site sends', 'text/plain', 403],
])(
  'Given %s with the author’s cookie, When it reaches the start, Then it is refused and nothing is created',
  async (_name, type, status) => {
    const response = await deckUploadsApi.request(
      'http://localhost/talk/uploads',
      {
        method: 'POST',
        headers: { Origin: 'https://evil.example', 'Content-Type': type },
        body: JSON.stringify(inventory),
      },
      platform.env,
    )

    expect(response.status).toBe(status)
    expect(await countDeployments()).toBe(0)
  },
)

test.each([
  ['another site', { Origin: 'https://evil.example' }],
  [
    'another site that says so',
    { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
  ],
  ['a sandboxed frame', { Origin: 'null', 'Sec-Fetch-Site': 'cross-site' }],
  ['a page of another port', { Origin: 'http://localhost:8080' }],
  ['a page of another scheme', { Origin: 'https://localhost' }],
  ['a sender that names no origin', { Origin: '' }],
])(
  'Given JSON from %s with the author’s cookie, When it reaches the start, Then it is refused and nothing is created',
  async (_name, headers) => {
    const response = await deckUploadsApi.request(
      'http://localhost/talk/uploads',
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(inventory),
      },
      platform.env,
    )

    expect(response.status).toBe(403)
    expect(await countDeployments()).toBe(0)
  },
)

test.each(['text/plain', 'application/x-www-form-urlencoded', ''])(
  'Given a start from the service’s own origin sent as %j, When it arrives, Then only JSON is accepted',
  async (type) => {
    const response = await deckUploadsApi.request(
      'http://localhost/talk/uploads',
      {
        method: 'POST',
        headers: { 'Content-Type': type },
        body: JSON.stringify(inventory),
      },
      platform.env,
    )

    expect(response.status).toBe(415)
    expect(await countDeployments()).toBe(0)
  },
)

test.each([
  ['no attempt', {}],
  ['a short attempt', { attempt: 'short' }],
  ['an attempt with other characters', { attempt: 'a'.repeat(15) + '/..' }],
  ['an attempt that is not text', { attempt: 1234567890123456 }],
])(
  'Given a start with %s, When it arrives, Then it is refused and nothing is created',
  async (_name, attempt) => {
    const response = await startApi.request(
      'http://localhost/talk/uploads',
      {
        method: 'POST',
        headers: {
          Cookie: session,
          Origin: 'http://localhost',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...inventory, ...attempt }),
      },
      testEnv(platform.env),
    )

    expect(response.status).toBe(400)
    expect(await countDeployments()).toBe(0)
  },
)

test('Given a started upload, When its row is read, Then it records the browser as where it was sent from and nothing of a workflow', async () => {
  expect((await start()).status).toBe(201)

  const [row] = await db.select().from(deployments)
  expect(row).toMatchObject({
    deck_id: 'talk',
    source: 'browser',
    publish_intent: null,
    start_revision: null,
  })
  for (const gone of ['source_sha', 'run_id', 'repository_id', 'actor_id'])
    expect(row).not.toHaveProperty(gone)
})

test('Given a start, When it answers, Then the receipt names the slide and its page for the author', async () => {
  const response = await start()

  expect(await response.json()).toMatchObject({
    slug: 'talk',
    manageUrl: 'http://localhost/slides/talk',
  })
})

test('given another configured author, when the first author starts an upload, then it is refused', async () => {
  const env = { ...platform.env, AUTHOR_GITHUB_IDS: '1' } as unknown as Env
  const response = await start(env)
  expect(response.status).toBe(403)
  expect(errorSchema.parse(await response.json()).code).toBe('invitation_only')
  expect(await countDeployments()).toBe(0)
})

test('F22-AC24: Given an upload in progress, When its author is removed from the registration, Then its credential stops working', async () => {
  const receipt = receiptSchema.parse(await (await start()).json())
  expect((await readStatus(receipt)).status).toBe(200)

  const removed = await uploadsApi.request(
    `http://localhost/${receipt.deploymentId}`,
    { headers: { Authorization: `Bearer ${receipt.credential}` } },
    { ...platform.env, AUTHOR_GITHUB_IDS: '1' } as unknown as Env,
  )

  expect(removed.status).toBe(403)
})

test('Given an upload in progress, When the author deletes the slide, Then its credential stops working and no new upload starts', async () => {
  const receipt = receiptSchema.parse(await (await start()).json())
  await db.update(decks).set({ deleted_at: 5 }).where(eq(decks.id, 'talk'))

  expect((await readStatus(receipt)).status).toBe(403)
  const finalize = await uploadsApi.request(
    `http://localhost/${receipt.deploymentId}/finalize`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${receipt.credential}` },
    },
    platform.env,
  )
  expect(finalize.status).toBe(403)
  expect((await start()).status).toBe(404)
})

test('given one attempt names two slides, when both start, then each slide gets its own session', async () => {
  await addDeck('second')
  const env = {
    ...platform.env,
    UPLOAD_LIMITS: { activeSessions: 2 },
  } as unknown as Env
  const first = receiptSchema.parse(await (await startDeck('talk', env)).json())
  const second = receiptSchema.parse(
    await (await startDeck('second', env)).json(),
  )
  expect(first.deploymentId).not.toBe(second.deploymentId)
  const deploymentDecks = await db
    .select({ deck_id: deployments.deck_id })
    .from(deployments)
    .orderBy(deployments.deck_id)
    .all()
  expect(deploymentDecks.map(({ deck_id }) => deck_id)).toEqual([
    'second',
    'talk',
  ])
})

test('given a session that names no slide, when its credential is used, then it is refused', async () => {
  const receipt = receiptSchema.parse(await (await start()).json())
  await db.update(deployments).set({ deck_id: null })

  expect((await readStatus(receipt)).status).toBe(403)
})

test('given the same attempt resends a different inventory, when it starts, then the conflict has a code and the first upload is kept', async () => {
  const send = (files: typeof inventory.files) =>
    deckUploadsApi.request(
      'http://localhost/talk/uploads',
      {
        method: 'POST',
        body: JSON.stringify({ attempt: 'a'.repeat(32), ...inventory, files }),
      },
      platform.env,
    )
  expect((await send(inventory.files)).status).toBe(201)

  const response = await send(twoFileInventory.files)

  expect(response.status).toBe(409)
  expect(errorSchema.parse(await response.json()).code).toBe(
    'inventory_conflict',
  )
  expect(await countDeployments()).toBe(1)
  expect(await db.$count(uploadFiles)).toBe(1)
})

test('F22-AC25: given two authors with a slide of one slug, when each starts an upload, then it goes to their own slide', async () => {
  await db.delete(decks)
  await db.batch([
    addDeck('k-alice', OWNER_ID, 'talk'),
    addDeck('k-bob', INVITED_ID, 'talk'),
  ])
  const env = {
    ...bothAuthors,
    UPLOAD_LIMITS: { activeSessions: 1 },
  } as unknown as Env

  expect((await startAsInvited()).status).toBe(201)
  expect((await start(env)).status).toBe(201)

  const rows = await db
    .select({ deck: deployments.deck_id })
    .from(deployments)
    .orderBy(deployments.deck_id)
  expect(rows).toEqual([{ deck: 'k-alice' }, { deck: 'k-bob' }])
})

test('given a slide with a random key, when an upload starts, then the idempotency key is made from the key and the attempt, and a replay finds the same deployment', async () => {
  await db.delete(decks)
  await addDeck('k-alice', OWNER_ID, 'talk')
  const send = () =>
    deckUploadsApi.request(
      'http://localhost/talk/uploads',
      {
        method: 'POST',
        body: JSON.stringify({ attempt: 'attempt-0123456789', ...inventory }),
      },
      platform.env,
    )

  const first = receiptSchema.parse(await (await send()).json())
  const replay = receiptSchema.parse(await (await send()).json())

  expect(replay.deploymentId).toBe(first.deploymentId)
  const [row] = await db.select().from(deployments)
  expect(row?.idempotency_key).toBe('k-alice:attempt-0123456789')
})

// Another entry, such as MCP, calls the start with an owner it has checked.
const directStart = (ownerUserId: string, env: Env = platform.env) =>
  startUpload(
    { env, req: { url: 'http://localhost/mcp' } },
    {
      ownerUserId,
      source: 'mcp',
      target: {
        kind: 'version',
        deck: {
          id: deckIdSchema.parse('talk'),
          slug: deckSlugSchema.parse('talk'),
        },
      },
      attempt: attemptSchema.parse('direct-start-attempt'),
      inventory: parseInventoryStructure(inventory),
    },
  )

test('Given an entry other than the browser, When it starts an upload for the slide’s owner, Then the version records where it was sent from and the receipt names the slide', async () => {
  const started = await directStart(OWNER_ID)

  expect(started).toMatchObject({
    state: 'uploading',
    slug: 'talk',
    manageUrl: 'http://localhost/slides/talk',
    statusUrl: `http://localhost/uploads/${started.deploymentId}`,
  })
  expect(started.credential).toEqual(expect.any(String))
  expect(
    await db.select({ source: deployments.source }).from(deployments),
  ).toEqual([{ source: 'mcp' }])
})

test.each([
  ['someone who does not own the slide', INVITED_ID, bothAuthors],
  [
    'an owner removed from the registration',
    OWNER_ID,
    { ...platform.env, AUTHOR_GITHUB_IDS: '1' } as unknown as Env,
  ],
])(
  'F22-AC17: Given an entry that names %s, When it starts an upload, Then it is refused and nothing is created',
  async (_name, ownerUserId, env) => {
    await expect(directStart(ownerUserId, env)).rejects.toMatchObject({
      status: 403,
    })
    expect(await countDeployments()).toBe(0)
  },
)

test('F22-AC17: Given an entry that names a suspended owner, When it starts an upload, Then it is refused and nothing is created', async () => {
  await db.insert(suspensions).values({
    user_id: OWNER_ID,
    reason: 'test',
    suspended_at: 1,
    suspended_by: 'operator',
  })
  try {
    await expect(directStart(OWNER_ID)).rejects.toMatchObject({ status: 403 })
    expect(await countDeployments()).toBe(0)
  } finally {
    await db.delete(suspensions)
  }
})

const startTwoFiles = (env: Env = platform.env, deck = 'talk') =>
  deckUploadsApi.request(
    `http://localhost/${deck}/uploads`,
    { method: 'POST', body: JSON.stringify(twoFileInventory) },
    env,
  )
const sessionStates = () =>
  db
    .select({
      id: deployments.id,
      state: deployments.state,
      expires: deployments.expires_at,
    })
    .from(deployments)

test('Given an upload a stopped sender left open, When the author starts another, Then the new one starts at once and the old one is given up', async () => {
  const stuck = receiptSchema.parse(await (await start()).json())
  const before = Math.floor(Date.now() / 1000)

  const response = await startTwoFiles()

  expect(response.status).toBe(201)
  const fresh = receiptSchema.parse(await response.json())
  expect(fresh.deploymentId).not.toBe(stuck.deploymentId)
  const states = await sessionStates()
  expect(states.find(({ id }) => id === fresh.deploymentId)?.state).toBe(
    'uploading',
  )
  const old = states.find(({ id }) => id === stuck.deploymentId)
  expect(old?.state).toBe('expired')
  // It expired now, not a day later, so its files are swept on time.
  expect(old?.expires).toBeGreaterThanOrEqual(before)
  expect(old?.expires).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
  const late = await uploadsApi.request(
    `http://localhost/${stuck.deploymentId}/files/0`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${stuck.credential}` },
      body: 'a',
    },
    platform.env,
  )
  expect(late.status).toBe(409)
  expect(errorSchema.parse(await late.json()).code).toBe('session_expired')
})

test('Given the stuck upload is of another slide of the author, When they start an upload, Then it is given up as well', async () => {
  await addDeck('second')
  const stuck = receiptSchema.parse(await (await start()).json())

  expect((await startTwoFiles(platform.env, 'second')).status).toBe(201)

  const states = await sessionStates()
  expect(states.find(({ id }) => id === stuck.deploymentId)?.state).toBe(
    'expired',
  )
})

test('Given an upload in the middle of receiving a file, When the author starts another, Then the one receiving is kept and the new start is asked to retry', async () => {
  const receiving = receiptSchema.parse(await (await start()).json())
  await db
    .update(deployments)
    .set({ lease_id: 'receiving', lease_until: 9999999999 })

  const response = await startTwoFiles()

  expect(response.status).toBe(429)
  expect(errorSchema.parse(await response.json()).code).toBe('upload_busy')
  expect(await sessionStates()).toMatchObject([
    { id: receiving.deploymentId, state: 'uploading' },
  ])
})

test('Given a receive whose lease ran out, When the author starts another, Then the stalled upload is given up', async () => {
  const stalled = receiptSchema.parse(await (await start()).json())
  await db.update(deployments).set({ lease_id: 'stalled', lease_until: 1 })

  expect((await startTwoFiles()).status).toBe(201)

  const states = await sessionStates()
  expect(states.find(({ id }) => id === stalled.deploymentId)?.state).toBe(
    'expired',
  )
})

test('Given room for two uploads at once, When the author starts a second, Then the first is left open', async () => {
  const env = {
    ...platform.env,
    UPLOAD_LIMITS: { activeSessions: 2 },
  } as unknown as Env
  expect((await start(env)).status).toBe(201)

  expect((await startTwoFiles(env)).status).toBe(201)

  expect((await sessionStates()).map(({ state }) => state)).toEqual([
    'uploading',
    'uploading',
  ])
})

test('Given another author has an upload open, When the first author starts one, Then the other author’s upload is not touched', async () => {
  await db.batch([
    addDeck('k-bob', INVITED_ID, 'talk'),
    db.update(decks).set({ slug: 'mine' }).where(eq(decks.id, 'talk')),
  ])
  expect((await startAsInvited()).status).toBe(201)
  const mine = (env: Env) =>
    deckUploadsApi.request(
      'http://localhost/mine/uploads',
      { method: 'POST', body: JSON.stringify(inventory) },
      env,
    )
  expect((await mine(bothAuthors)).status).toBe(201)

  expect((await startTwoFiles(bothAuthors, 'mine')).status).toBe(201)

  expect(
    await db
      .select({ deck: deployments.deck_id, state: deployments.state })
      .from(deployments)
      .orderBy(deployments.deck_id, deployments.state),
  ).toEqual([
    { deck: 'k-bob', state: 'uploading' },
    { deck: 'talk', state: 'expired' },
    { deck: 'talk', state: 'uploading' },
  ])
})

test('F22-AC20: Given a public slide and an upload left open, When a new start gives the old one up, Then the public version stays as it was', async () => {
  const earlier = receiptSchema.parse(await (await start()).json())
  await db.batch([
    db.delete(uploadFiles),
    db
      .update(deployments)
      .set({ state: 'ready', ready_at: 1, idempotency_key: 'earlier' }),
    db
      .update(decks)
      .set({ public_deployment_id: earlier.deploymentId, revision: 3 }),
  ])
  expect((await start()).status).toBe(201)
  const before = await publication()

  expect((await startTwoFiles()).status).toBe(201)

  expect(await publication()).toEqual(before)
  expect(
    (await sessionStates()).find(({ id }) => id === earlier.deploymentId)
      ?.state,
  ).toBe('ready')
})
