import { and, eq, exists, gt, isNull, lte, notExists, or } from 'drizzle-orm'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import {
  Hono,
  type Context,
  type ErrorHandler,
  type MiddlewareHandler,
} from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  deployments,
  uploadFiles,
  deploymentRowSchema,
  uploadFileRowSchema,
  type Deployment,
} from '../db/schema'
import {
  digestUploadInventory,
  MAX_INVENTORY_METADATA_BYTES,
  parseInventoryStructure,
} from './inventory'
import { parseUploadLimits, type UploadLimits } from './limits'
import { deckIdSchema } from '../decks/binding'
import { readDeckPolicy } from '../decks/store'
import { isAllowedSource, sourceOf, verifyGitHubToken } from './oidc'
import { uploadResourcePolicy } from './content-policy'
import {
  inventoryRejection,
  quotaDecision,
  startRejectionResponse,
  type StartRejection,
} from './rejections'
import {
  checkCredential,
  closedSessionCode,
  resumeSession,
  writeDecision,
  type SessionErrorCode,
} from './session'
import {
  insertRejectedStart,
  deploymentExists,
  insertSessionWithinQuota,
  readQuotaUsage,
  type NewSession,
} from './start-store'
import { checkStoredObject, hexDigest } from './stored-objects'
import { applyCiPublication } from '../publication/ci'
import { TITLE_SCAN_BYTES, titleOf } from './title'
import { recordCitations } from '../reactions/record'
import { parseStartRequest } from '../publication/intent'

const api = new Hono<{ Bindings: Env }>()
type UploadContext = Context<{ Bindings: Env }>
const now = () => Math.floor(Date.now() / 1000)
const uploadLimits = (c: UploadContext) =>
  parseUploadLimits(c.env.UPLOAD_LIMITS)
type UploadErrorCode =
  | SessionErrorCode
  | 'immutable'
  | 'start_rejected'
  | 'upload_busy'
  | 'inventory_conflict'
  | 'intent_conflict'
  | 'source_changed'
class UploadError extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
    message: string,
    readonly code?: UploadErrorCode,
    readonly details: Readonly<Record<string, string>> = {},
  ) {
    super(status, { message })
  }
}
function fail(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
  message: string,
  code?: UploadErrorCode,
  details?: Readonly<Record<string, string>>,
): never {
  throw new UploadError(status, message, code, details)
}
const sessionErrors: Readonly<
  Record<SessionErrorCode | 'immutable', readonly [401 | 409, string]>
> = {
  // Only an expired credential can be fixed by re-authenticating.
  credential_expired: [
    401,
    'Upload credential expired; re-authenticate with GitHub Actions OIDC',
  ],
  immutable: [409, 'Ready deployment is immutable'],
  session_expired: [
    409,
    'Upload session expired; start a new workflow attempt',
  ],
  session_failed: [409, 'Upload session failed; start a new workflow attempt'],
  session_changed: [409, 'Upload session changed by another request; retry'],
}
function failSession(
  code: SessionErrorCode | 'immutable',
  row?: Pick<Deployment, 'failure_reason'>,
): never {
  const [status, message] = sessionErrors[code]
  const reason = row?.failure_reason
  return fail(status, message, code, reason ? { reason } : {})
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return hexDigest(digest) ?? ''
}
export async function readBounded(request: Request, maximum: number) {
  if (Number(request.headers.get('content-length')) > maximum)
    fail(413, 'Request exceeds byte limit')
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maximum) {
        await reader.cancel()
        fail(413, 'Request exceeds byte limit')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
function bearer(c: UploadContext) {
  const match = /^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(
    c.req.header('authorization') ?? '',
  )
  return match?.[1] ?? fail(401, 'Bearer credential required')
}
async function deployment(c: UploadContext) {
  const tokenHash = await sha256(new TextEncoder().encode(bearer(c)))
  const row = await drizzle(c.env.DB)
    .select()
    .from(deployments)
    .where(
      and(
        eq(
          deployments.id,
          c.req.param('id') ?? fail(401, 'Upload ID required'),
        ),
        eq(deployments.token_hash, tokenHash),
      ),
    )
    .get()
    .then((result) => deploymentRowSchema.optional().parse(result))
  if (!row) fail(401, 'Invalid or expired upload credential')
  const access = checkCredential(row, now())
  if (!access.ok) failSession(access.code, row)
  const source = {
    repositoryId: row.repository_id,
    repositoryOwnerId: row.owner_id,
    actorId: row.actor_id,
    ref: row.source_ref,
  }
  if (!row.deck_id || (await allowedDeckOwner(c, row.deck_id, source)) === null)
    fail(403, 'Repository binding changed')
  return row
}
/**
 * Checks a workflow identity against the deck's current repository binding
 * and the owner allowlist, so revoking either stops further uploads. Returns
 * the deck owner when allowed, and null otherwise.
 */
async function allowedDeckOwner(
  c: UploadContext,
  deckId: string,
  source: Parameters<typeof isAllowedSource>[0],
): Promise<string | null> {
  const policy = await readDeckPolicy(c.env.DB, deckId)
  return policy !== null &&
    policy.ownerUserId === c.env.GITHUB_ACTOR_ID &&
    isAllowedSource(source, policy)
    ? policy.ownerUserId
    : null
}
async function files(c: UploadContext, id: string) {
  return drizzle(c.env.DB)
    .select()
    .from(uploadFiles)
    .where(eq(uploadFiles.deployment_id, id))
    .orderBy(uploadFiles.path)
    .all()
    .then((result) => uploadFileRowSchema.array().parse(result))
}
async function receipt(c: UploadContext, row: Deployment) {
  return {
    deploymentId: row.id,
    commit: row.source_sha,
    state: row.state,
    expiresAt: row.expires_at,
    credentialExpiresAt: row.credential_expires_at,
    statusUrl: new URL(`/uploads/${row.id}`, c.req.url).href,
    failureReason: row.failure_reason,
    files: (await files(c, row.id)).map((file) => ({
      id: file.id,
      path: file.path,
      size: file.size,
      sha256: file.sha256,
      received: file.object_key !== null,
    })),
  }
}
const noStore: MiddlewareHandler = async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  await next()
}
api.use('*', noStore)
async function uploadIdentity(c: UploadContext) {
  try {
    return await verifyGitHubToken(bearer(c), c.env.OIDC_AUDIENCE)
  } catch {
    return fail(401, 'GitHub Actions identity rejected')
  }
}
function invalidInventory(error: unknown): never {
  if (error instanceof HTTPException) throw error
  return fail(
    400,
    error instanceof SyntaxError
      ? 'Invalid JSON inventory'
      : 'Invalid static file inventory',
  )
}
function startRequest(json: unknown) {
  try {
    return parseStartRequest(json)
  } catch {
    return fail(
      400,
      'Invalid publication request; use { "published": boolean }',
    )
  }
}
async function requestStart(request: Request) {
  try {
    const bytes = await readBounded(request, MAX_INVENTORY_METADATA_BYTES)
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
    const start = startRequest(json)
    return {
      inventory: parseInventoryStructure(start.inventory),
      intent: start.intent,
    }
  } catch (error) {
    return invalidInventory(error)
  }
}
function failConcurrentStart(): never {
  return fail(429, 'Concurrent start; retry', 'upload_busy')
}
async function rejectStart(
  db: DrizzleD1Database,
  session: NewSession,
  reason: StartRejection,
  limits: UploadLimits,
): Promise<never> {
  // The refusal is reported even when it cannot be recorded.
  const recorded = await insertRejectedStart(db, session, reason, limits)
  if (!recorded && (await deploymentExists(db, session.key)))
    failConcurrentStart()
  const { status, message } = startRejectionResponse(reason)
  return fail(
    status,
    message,
    'start_rejected',
    recorded ? { reason, deploymentId: session.id } : { reason },
  )
}
async function createSession(
  db: DrizzleD1Database,
  session: NewSession,
  limits: UploadLimits,
) {
  // Inventory limits apply only when a session is created.
  const refused = inventoryRejection(session.inventory, limits)
  if (refused) return rejectStart(db, session, refused, limits)
  if (await insertSessionWithinQuota(db, session, limits)) return
  // A concurrent request for the same attempt won; a retry replays it.
  if (await deploymentExists(db, session.key)) failConcurrentStart()
  const usage = await readQuotaUsage(db, session.ownerUserId, session.created)
  const decision = quotaDecision(usage, session.inventory.totalBytes, limits)
  if (decision.kind === 'rejected')
    return rejectStart(db, session, decision.reason, limits)
  return fail(
    429,
    decision.kind === 'busy'
      ? 'Another upload is in progress; retry later'
      : 'Concurrent start; retry',
    'upload_busy',
  )
}
/**
 * Reports a refused guarded write. A session that closed meanwhile gets its
 * terminal code; otherwise the refusal is a conflict the caller may retry.
 */
async function holdsLease(c: UploadContext, id: string, lease: string) {
  const at = now()
  const row = await drizzle(c.env.DB)
    .select({ id: deployments.id })
    .from(deployments)
    .where(
      and(
        eq(deployments.id, id),
        eq(deployments.state, 'uploading'),
        eq(deployments.lease_id, lease),
        gt(deployments.lease_until, at),
        gt(deployments.expires_at, at),
      ),
    )
    .get()
  return row !== undefined
}
async function readDeployment(c: UploadContext, id: string) {
  return drizzle(c.env.DB)
    .select()
    .from(deployments)
    .where(eq(deployments.id, id))
    .get()
    .then((result) => deploymentRowSchema.optional().parse(result))
}
async function failRefusedWrite(
  c: UploadContext,
  id: string,
  conflict: string,
): Promise<never> {
  const row = await readDeployment(c, id)
  const code = row ? closedSessionCode(row, now()) : 'session_expired'
  return code ? failSession(code, row) : fail(409, conflict)
}
function assertWritable(row: Deployment) {
  const decision = writeDecision(row)
  if (!decision.ok) failSession(decision.code, row)
}
async function rotateCredential(
  c: UploadContext,
  existing: Deployment,
  tokenHash: string,
  limits: UploadLimits,
  at: number,
) {
  const decision = resumeSession(existing, at, limits)
  if (!decision.ok) failSession(decision.code, existing)
  const rotated = await drizzle(c.env.DB)
    .update(deployments)
    .set({
      token_hash: tokenHash,
      credential_expires_at: decision.credentialExpiresAt,
    })
    .where(
      and(
        eq(deployments.id, existing.id),
        eq(deployments.state, existing.state),
        eq(deployments.token_hash, existing.token_hash),
        existing.state === 'uploading'
          ? gt(deployments.expires_at, at)
          : undefined,
      ),
    )
    .run()
  if (!rotated.meta.changes) failSession('session_changed')
}
/** Starts or resumes an upload session for one deck. */
export const deckUploadsApi = new Hono<{ Bindings: Env }>()
deckUploadsApi.use('*', noStore)
deckUploadsApi.post('/:deck/uploads', async (c) => {
  const deck = deckIdSchema.safeParse(c.req.param('deck'))
  if (!deck.success) fail(404, 'Unknown deck')
  const claims = await uploadIdentity(c)
  const ownerUserId = await allowedDeckOwner(c, deck.data, sourceOf(claims))
  if (ownerUserId === null)
    fail(403, 'Repository is not connected to this deck')
  // Invalid configuration fails every start, including replays.
  const limits = uploadLimits(c)
  const { inventory, intent } = await requestStart(c.req.raw)
  const digest = await digestUploadInventory(inventory)
  const key = `${deck.data}:${claims.repository_id}:${claims.run_id}:${claims.run_attempt}:${digest}`
  const db = drizzle(c.env.DB)
  const existing = await db
    .select()
    .from(deployments)
    .where(eq(deployments.idempotency_key, key))
    .get()
    .then((result) => deploymentRowSchema.optional().parse(result))
  if (existing && existing.inventory_digest !== digest)
    fail(
      409,
      'This workflow run already has a different inventory',
      'inventory_conflict',
    )
  if (existing && existing.publish_intent !== intent)
    fail(
      409,
      'This workflow run already asked for a different publication',
      'intent_conflict',
    )
  const id = existing?.id ?? crypto.randomUUID()
  const credential = `${crypto.randomUUID()}.${crypto.randomUUID()}`
  const tokenHash = await sha256(new TextEncoder().encode(credential))
  const created = now()
  if (!existing) {
    await createSession(
      db,
      {
        id,
        key,
        digest,
        deckId: deck.data,
        ownerUserId,
        claims,
        inventory,
        intent,
        tokenHash,
        created,
      },
      limits,
    )
  } else {
    if (existing.source_sha !== claims.sha)
      fail(409, 'Workflow source changed', 'source_changed')
    await rotateCredential(c, existing, tokenHash, limits, created)
  }
  if (existing?.state !== 'ready') {
    const [first, ...rest] = inventory.files.map((file, index) =>
      db
        .insert(uploadFiles)
        .values({
          deployment_id: id,
          id: String(index),
          path: file.path,
          size: file.size,
          sha256: file.sha256,
          media_type: file.mediaType,
        })
        .onConflictDoNothing(),
    )
    if (first) await db.batch([first, ...rest])
  }
  const row = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, id))
    .get()
    .then((result) => deploymentRowSchema.optional().parse(result))
  if (!row) throw new Error('Deployment creation failed')
  return c.json({ ...(await receipt(c, row)), credential }, 201)
})
api.get('/:id', async (c) => c.json(await receipt(c, await deployment(c))))
api.put('/:id/files/:fileId', async (c) => {
  const row = await deployment(c)
  assertWritable(row)
  const db = drizzle(c.env.DB)
  const file = await db
    .select()
    .from(uploadFiles)
    .where(
      and(
        eq(uploadFiles.deployment_id, row.id),
        eq(uploadFiles.id, c.req.param('fileId')),
      ),
    )
    .get()
    .then((result) => uploadFileRowSchema.optional().parse(result))
  if (!file) fail(404, 'Unknown upload file')
  if (file.object_key) return c.json({ received: true, id: file.id })
  const lease = crypto.randomUUID()
  const leaseSeconds = uploadLimits(c).receiveLeaseSeconds
  const acquired = await db
    .update(deployments)
    .set({ lease_id: lease, lease_until: now() + leaseSeconds })
    .where(
      and(
        eq(deployments.id, row.id),
        eq(deployments.state, 'uploading'),
        gt(deployments.expires_at, now()),
        or(isNull(deployments.lease_id), lte(deployments.lease_until, now())),
      ),
    )
    .run()
  if (!acquired.meta.changes)
    await failRefusedWrite(c, row.id, 'Another file is being received; retry')
  const key = `${row.id}/${file.id}/${lease}`
  try {
    const bytes = await readBounded(c.req.raw, file.size)
    if (bytes.byteLength !== file.size || (await sha256(bytes)) !== file.sha256)
      fail(400, 'File size or SHA-256 mismatch')
    // Cleanup expires sessions by dropping their lease, and sweeps a prefix
    // only after the longest lease. Checking the lease right before writing
    // keeps a stalled receive from adding an object after that sweep.
    if (!(await holdsLease(c, row.id, lease)))
      await failRefusedWrite(c, row.id, 'Receive lease expired; retry')
    await c.env.UPLOADS.put(key, bytes, {
      httpMetadata: { contentType: file.media_type },
      // R2 rejects the write if the stored bytes differ, and keeps the
      // checksum so finalize can verify the object later.
      sha256: file.sha256,
    })
    const stored = await db
      .update(uploadFiles)
      .set({ object_key: key })
      .where(
        and(
          eq(uploadFiles.deployment_id, row.id),
          eq(uploadFiles.id, file.id),
          exists(
            db
              .select({ id: deployments.id })
              .from(deployments)
              .where(
                and(
                  eq(deployments.id, row.id),
                  eq(deployments.state, 'uploading'),
                  eq(deployments.lease_id, lease),
                  gt(deployments.lease_until, now()),
                  gt(deployments.expires_at, now()),
                ),
              ),
          ),
        ),
      )
      .run()
    if (!stored.meta.changes) {
      await c.env.UPLOADS.delete(key)
      await failRefusedWrite(c, row.id, 'Receive lease expired; retry')
    }
    return c.json({ received: true, id: file.id })
  } finally {
    await db
      .update(deployments)
      .set({ lease_id: null, lease_until: null })
      .where(and(eq(deployments.id, row.id), eq(deployments.lease_id, lease)))
      .run()
  }
})
/**
 * Returns files that still need to be sent. A receipt whose R2 object is
 * missing or differs is cleared so the uploader can send the file again.
 */
async function headObject(bucket: R2Bucket, key: string) {
  const head = await bucket.head(key)
  return head && { size: head.size, sha256: hexDigest(head.checksums.sha256) }
}
async function checkReceivedFiles(c: UploadContext, id: string) {
  const settled = await Promise.allSettled(
    (await files(c, id)).map(async (file) => ({
      file,
      check: file.object_key
        ? checkStoredObject(
            file,
            await headObject(c.env.UPLOADS, file.object_key),
          )
        : ('missing' as const),
    })),
  )
  // A storage error proves nothing about the object, so finalize is retried.
  if (settled.some(({ status }) => status === 'rejected'))
    fail(429, 'Could not verify stored files; retry finalize', 'upload_busy')
  return settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  )
}
/**
 * Returns files that still need to be sent. A receipt whose R2 object is
 * missing or differs is cleared, in one batch, so the uploader can send the
 * file again; its object is then deleted.
 */
async function unverifiedFiles(c: UploadContext, id: string) {
  const db = drizzle(c.env.DB)
  const unverified = (await checkReceivedFiles(c, id)).filter(
    ({ check }) => check !== 'ok',
  )
  const cleared = unverified.flatMap(({ file, check }) =>
    file.object_key ? [{ file, key: file.object_key, check }] : [],
  )
  const [first, ...rest] = cleared.map(({ file, key }) =>
    db
      .update(uploadFiles)
      .set({ object_key: null })
      .where(
        and(
          eq(uploadFiles.deployment_id, id),
          eq(uploadFiles.id, file.id),
          eq(uploadFiles.object_key, key),
          // A concurrent finalize may already have made the file map ready.
          exists(
            db
              .select({ id: deployments.id })
              .from(deployments)
              .where(
                and(eq(deployments.id, id), eq(deployments.state, 'uploading')),
              ),
          ),
        ),
      ),
  )
  if (first) {
    const results = await db.batch([first, ...rest])
    const removed = cleared.filter((_, index) => results[index]?.meta.changes)
    for (const { file, key, check } of removed)
      console.error(
        JSON.stringify({
          event: 'upload_object_unverified',
          deploymentId: id,
          fileId: file.id,
          check,
        }),
      )
    if (removed.length)
      await c.env.UPLOADS.delete(removed.map(({ key }) => key))
  }
  return unverified.map(({ file }) => file)
}
/**
 * The receipt of a ready deployment, after applying the publication its
 * workflow asked for. Every finalize does this, so a retry after a failure
 * between ready and publication still applies it.
 */
async function readyReceipt(c: UploadContext, row: Deployment) {
  const result = await applyCiPublication(c.env.DB, row, now())
  const publication =
    result.kind === 'skipped'
      ? { applied: false, reason: result.reason }
      : { applied: true }
  return { ...(await receipt(c, row)), publication }
}
/**
 * The title of a deployment's verified index.html. A title only names the
 * deck in lists, so a storage error leaves it null instead of failing.
 */
async function readEntryTitle(c: UploadContext, id: string) {
  const entry = await drizzle(c.env.DB)
    .select({ key: uploadFiles.object_key })
    .from(uploadFiles)
    .where(
      and(
        eq(uploadFiles.deployment_id, id),
        eq(uploadFiles.path, 'index.html'),
      ),
    )
    .get()
  if (!entry?.key) return null
  try {
    const object = await c.env.UPLOADS.get(entry.key, {
      range: { offset: 0, length: TITLE_SCAN_BYTES },
    })
    return object ? titleOf(await object.text()) : null
  } catch {
    return null
  }
}
api.post('/:id/finalize', async (c) => {
  const row = await deployment(c)
  if (row.state === 'ready') return c.json(await readyReceipt(c, row))
  assertWritable(row)
  const missing = await unverifiedFiles(c, row.id)
  if (missing.length) {
    // A concurrent finalize may have made the deployment ready meanwhile.
    const current = await readDeployment(c, row.id)
    if (current?.state === 'ready')
      return c.json(await readyReceipt(c, current))
    return c.json(
      {
        error: 'Files are missing',
        code: 'files_missing',
        missing: missing.map((file) => file.path),
      },
      409,
    )
  }
  const title = await readEntryTitle(c, row.id)
  // Before the deployment is ready, so a retried finalize records them too.
  await recordCitations(c.env, row.id)
  const db = drizzle(c.env.DB)
  const result = await db
    .update(deployments)
    .set({ state: 'ready', ready_at: now(), title })
    .where(
      and(
        eq(deployments.id, row.id),
        eq(deployments.state, 'uploading'),
        gt(deployments.expires_at, now()),
        or(isNull(deployments.lease_id), lte(deployments.lease_until, now())),
        exists(
          db
            .select({ id: uploadFiles.id })
            .from(uploadFiles)
            .where(
              and(
                eq(uploadFiles.deployment_id, row.id),
                eq(uploadFiles.path, 'index.html'),
              ),
            ),
        ),
        notExists(
          db
            .select({ id: uploadFiles.id })
            .from(uploadFiles)
            .where(
              and(
                eq(uploadFiles.deployment_id, row.id),
                isNull(uploadFiles.object_key),
              ),
            ),
        ),
      ),
    )
    .run()
  const ready = await readDeployment(c, row.id)
  // A concurrent finalize may have won; its result is this one's too.
  if (ready?.state === 'ready') return c.json(await readyReceipt(c, ready))
  if (!result.meta.changes)
    await failRefusedWrite(c, row.id, 'Upload is in progress; retry finalize')
  throw new Error('Ready deployment disappeared')
})
api.get('/:id/content/*', async (c) => {
  const row = await deployment(c)
  if (row.state !== 'ready') fail(409, 'Deployment is not ready')
  const path = c.req.path.slice(
    c.req.path.indexOf('/content/') + '/content/'.length,
  )
  const file = await drizzle(c.env.DB)
    .select()
    .from(uploadFiles)
    .where(
      and(
        eq(uploadFiles.deployment_id, row.id),
        eq(uploadFiles.path, decodeURIComponent(path ?? '')),
      ),
    )
    .get()
    .then((result) => uploadFileRowSchema.optional().parse(result))
  if (!file?.object_key) fail(404, 'File not found')
  const object = await c.env.UPLOADS.get(file.object_key)
  if (!object) fail(404, 'Stored file not found')
  return new Response(object.body, {
    headers: {
      'Content-Type': file.media_type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `sandbox; ${uploadResourcePolicy}`,
      'Content-Disposition': 'inline',
    },
  })
})
const handleUploadError: ErrorHandler<{ Bindings: Env }> = (error, c) => {
  if (error instanceof UploadError && error.code)
    return c.json(
      { ...error.details, error: error.message, code: error.code },
      error.status,
    )
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status)
  console.error(JSON.stringify({ event: 'upload_api_error', name: error.name }))
  return c.json({ error: 'Upload service failed; retry the request' }, 500)
}
api.onError(handleUploadError)
deckUploadsApi.onError(handleUploadError)
export { api as uploadsApi }
