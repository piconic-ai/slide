import {
  and,
  eq,
  exists,
  gt,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  deployments,
  uploadFiles,
  deploymentRowSchema,
  uploadFileRowSchema,
} from '../db/schema'
import {
  assertWithinUploadLimits,
  digestUploadInventory,
  MAX_INVENTORY_METADATA_BYTES,
  parseInventoryStructure,
  type UploadInventory,
} from './inventory'
import {
  parseUploadLimits,
  START_WINDOW_SECONDS,
  type UploadLimits,
} from './limits'
import { verifyGitHubToken } from './oidc'
import { uploadResourcePolicy } from './content-policy'
import {
  checkCredential,
  credentialExpiry,
  resumeSession,
  type SessionErrorCode,
} from './session'

const api = new Hono<{ Bindings: Env }>()
type UploadContext = Context<{ Bindings: Env }>
type Deployment = typeof deployments.$inferSelect
const now = () => Math.floor(Date.now() / 1000)
const uploadLimits = (c: UploadContext) =>
  parseUploadLimits(c.env.UPLOAD_LIMITS)
class UploadError extends HTTPException {
  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
    message: string,
    readonly code?: SessionErrorCode,
  ) {
    super(status, { message })
  }
}
function fail(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
  message: string,
  code?: SessionErrorCode,
): never {
  throw new UploadError(status, message, code)
}
const sessionErrors: Readonly<Record<SessionErrorCode, string>> = {
  credential_expired:
    'Upload credential expired; re-authenticate with GitHub Actions OIDC',
  session_expired: 'Upload session expired; start a new workflow attempt',
  session_failed: 'Upload session failed; start a new workflow attempt',
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
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
  if (!access.ok) fail(401, sessionErrors[access.code], access.code)
  if (
    row.actor_id !== c.env.GITHUB_ACTOR_ID ||
    row.repository_id !== c.env.GITHUB_REPOSITORY_ID ||
    row.owner_id !== c.env.GITHUB_OWNER_ID ||
    !c.env.GITHUB_ALLOWED_REFS.split(',').includes(row.source_ref)
  ) {
    fail(403, 'Repository binding changed')
  }
  return row
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
    statusUrl: new URL(`/uploads/${row.id}`, c.req.url).href,
    files: (await files(c, row.id)).map((file) => ({
      id: file.id,
      path: file.path,
      size: file.size,
      sha256: file.sha256,
      received: file.object_key !== null,
    })),
  }
}
api.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  await next()
})
async function uploadIdentity(c: UploadContext) {
  try {
    return await verifyGitHubToken(bearer(c), c.env)
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
async function requestInventory(request: Request) {
  try {
    const bytes = await readBounded(request, MAX_INVENTORY_METADATA_BYTES)
    return parseInventoryStructure(JSON.parse(new TextDecoder().decode(bytes)))
  } catch (error) {
    return invalidInventory(error)
  }
}
function withinLimits(inventory: UploadInventory, limits: UploadLimits) {
  try {
    return assertWithinUploadLimits(inventory, limits)
  } catch (error) {
    return invalidInventory(error)
  }
}
async function rotateCredential(
  c: UploadContext,
  existing: Deployment,
  tokenHash: string,
) {
  const decision = resumeSession(existing, now(), uploadLimits(c))
  if (!decision.ok) fail(409, sessionErrors[decision.code], decision.code)
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
      ),
    )
    .run()
  if (!rotated.meta.changes) fail(409, 'Upload session changed; retry')
}
api.post('/', async (c) => {
  const claims = await uploadIdentity(c)
  // Invalid configuration fails every start, including replays.
  const limits = uploadLimits(c)
  const inventory = await requestInventory(c.req.raw)
  const digest = await digestUploadInventory(inventory)
  const key = `${claims.repository_id}:${claims.run_id}:${claims.run_attempt}:${digest}`
  const db = drizzle(c.env.DB)
  const existing = await db
    .select()
    .from(deployments)
    .where(eq(deployments.idempotency_key, key))
    .get()
    .then((result) => deploymentRowSchema.optional().parse(result))
  if (existing && existing.inventory_digest !== digest)
    fail(409, 'This workflow run already has a different inventory')
  const id = existing?.id ?? crypto.randomUUID()
  const credential = `${crypto.randomUUID()}.${crypto.randomUUID()}`
  const tokenHash = await sha256(new TextEncoder().encode(credential))
  const created = now()
  if (!existing) {
    // Inventory limits apply only when a session is created.
    withinLimits(inventory, limits)
    const result = await db
      .insert(deployments)
      .select(
        db
          .select({
            id: sql<string>`${id}`.as('id'),
            idempotency_key: sql<string>`${key}`.as('idempotency_key'),
            inventory_digest: sql<string>`${digest}`.as('inventory_digest'),
            source_sha: sql<string>`${claims.sha}`.as('source_sha'),
            run_id: sql<string>`${claims.run_id}`.as('run_id'),
            run_attempt: sql<string>`${claims.run_attempt}`.as('run_attempt'),
            actor_id: sql<string>`${claims.actor_id}`.as('actor_id'),
            repository_id: sql<string>`${claims.repository_id}`.as(
              'repository_id',
            ),
            owner_id: sql<string>`${claims.repository_owner_id}`.as('owner_id'),
            source_ref: sql<string>`${claims.ref}`.as('source_ref'),
            state: sql<'uploading'>`'uploading'`.as('state'),
            total_bytes: sql<number>`${inventory.totalBytes}`.as('total_bytes'),
            token_hash: sql<string>`${tokenHash}`.as('token_hash'),
            created_at: sql<number>`${created}`.as('created_at'),
            expires_at: sql<number>`${created + limits.sessionSeconds}`.as(
              'expires_at',
            ),
            credential_expires_at: sql<number>`${credentialExpiry(
              created + limits.sessionSeconds,
              created,
              limits,
            )}`.as('credential_expires_at'),
            lease_id: sql<null>`NULL`.as('lease_id'),
            lease_until: sql<null>`NULL`.as('lease_until'),
            ready_at: sql<null>`NULL`.as('ready_at'),
            failure_reason: sql<null>`NULL`.as('failure_reason'),
          })
          .from(sql`(SELECT 1)`)
          .where(
            and(
              sql`(SELECT COALESCE(SUM(${deployments.total_bytes}), 0) FROM ${deployments}
          WHERE ${deployments.state} = 'ready'
            OR (${deployments.state} = 'uploading' AND ${deployments.expires_at} > ${created}))
          + ${inventory.totalBytes} <= ${limits.authorBytes}`,
              sql`(SELECT COUNT(*) FROM ${deployments}
          WHERE ${deployments.state} = 'uploading' AND ${deployments.expires_at} > ${created}) < ${limits.activeSessions}`,
              sql`(SELECT COUNT(*) FROM ${deployments}
          WHERE ${deployments.created_at} > ${created - START_WINDOW_SECONDS}) < ${limits.startsPerDay}`,
            ),
          ),
      )
      .onConflictDoNothing()
      .run()
    if (!result.meta.changes)
      fail(429, 'Upload quota reached or concurrent start; retry later')
  } else {
    if (existing.source_sha !== claims.sha) fail(409, 'Workflow source changed')
    await rotateCredential(c, existing, tokenHash)
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
  if (row.state !== 'uploading') fail(409, 'Ready deployment is immutable')
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
        or(isNull(deployments.lease_id), lte(deployments.lease_until, now())),
      ),
    )
    .run()
  if (!acquired.meta.changes) fail(409, 'Another file is being received; retry')
  const key = `${row.id}/${file.id}/${lease}`
  try {
    const bytes = await readBounded(c.req.raw, file.size)
    if (bytes.byteLength !== file.size || (await sha256(bytes)) !== file.sha256)
      fail(400, 'File size or SHA-256 mismatch')
    await c.env.UPLOADS.put(key, bytes, {
      httpMetadata: { contentType: file.media_type },
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
                ),
              ),
          ),
        ),
      )
      .run()
    if (!stored.meta.changes) {
      await c.env.UPLOADS.delete(key)
      fail(409, 'Receive lease expired; retry')
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
api.post('/:id/finalize', async (c) => {
  const row = await deployment(c)
  if (row.state === 'ready') return c.json(await receipt(c, row))
  const missing = (await files(c, row.id)).filter((file) => !file.object_key)
  if (missing.length)
    return c.json(
      { error: 'Files are missing', missing: missing.map((file) => file.path) },
      409,
    )
  const db = drizzle(c.env.DB)
  const result = await db
    .update(deployments)
    .set({ state: 'ready', ready_at: now() })
    .where(
      and(
        eq(deployments.id, row.id),
        eq(deployments.state, 'uploading'),
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
  if (!result.meta.changes) fail(409, 'Upload is in progress; retry finalize')
  return c.json(await receipt(c, { ...row, state: 'ready' }))
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
api.onError((error, c) => {
  if (error instanceof UploadError && error.code)
    return c.json({ error: error.message, code: error.code }, error.status)
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status)
  console.error(JSON.stringify({ event: 'upload_api_error', name: error.name }))
  return c.json({ error: 'Upload service failed; retry the request' }, 500)
})
export { api as uploadsApi }
