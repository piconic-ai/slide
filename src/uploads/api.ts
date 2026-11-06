import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  digestUploadInventory,
  MAX_INVENTORY_METADATA_BYTES,
  parseUploadInventory,
} from './inventory'
import { DEFAULT_UPLOAD_LIMITS as limits } from './limits'
import { verifyGitHubToken } from './oidc'

const api = new Hono<{ Bindings: Env }>()
type UploadContext = Context<{ Bindings: Env }>
type Deployment = {
  id: string
  inventory_digest: string
  source_sha: string
  state: 'uploading' | 'ready'
  token_hash: string
  expires_at: number
  actor_id: string
  repository_id: string
  owner_id: string
  source_ref: string
  lease_id: string | null
  lease_until: number | null
}
type FileRow = {
  id: string
  path: string
  size: number
  sha256: string
  media_type: string
  object_key: string | null
}
const now = () => Math.floor(Date.now() / 1000)
function fail(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
  message: string,
): never {
  throw new HTTPException(status, { message })
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
  const row = await c.env.DB.prepare(
    'SELECT * FROM deployments WHERE id = ? AND token_hash = ?',
  )
    .bind(c.req.param('id'), tokenHash)
    .first<Deployment>()
  if (!row || row.expires_at <= now())
    fail(401, 'Invalid or expired upload credential')
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
  return (
    await c.env.DB.prepare(
      'SELECT id,path,size,sha256,media_type,object_key FROM upload_files WHERE deployment_id = ? ORDER BY path',
    )
      .bind(id)
      .all<FileRow>()
  ).results
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
async function requestInventory(request: Request) {
  try {
    const bytes = await readBounded(request, MAX_INVENTORY_METADATA_BYTES)
    return parseUploadInventory(JSON.parse(new TextDecoder().decode(bytes)))
  } catch (error) {
    if (error instanceof HTTPException) throw error
    return fail(
      400,
      error instanceof SyntaxError
        ? 'Invalid JSON inventory'
        : 'Invalid static file inventory',
    )
  }
}
api.post('/', async (c) => {
  const claims = await uploadIdentity(c)
  const inventory = await requestInventory(c.req.raw)
  const digest = await digestUploadInventory(inventory)
  const key = `${claims.repository_id}:${claims.run_id}:${claims.run_attempt}:${digest}`
  const existing = await c.env.DB.prepare(
    'SELECT * FROM deployments WHERE idempotency_key = ?',
  )
    .bind(key)
    .first<Deployment>()
  if (existing && existing.inventory_digest !== digest)
    fail(409, 'This workflow run already has a different inventory')
  if (existing && existing.expires_at <= now())
    fail(409, 'Upload session expired; start a new workflow attempt')
  const id = existing?.id ?? crypto.randomUUID()
  const credential = `${crypto.randomUUID()}.${crypto.randomUUID()}`
  const tokenHash = await sha256(new TextEncoder().encode(credential))
  const created = now()
  if (!existing) {
    const result = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO deployments
      (id,idempotency_key,inventory_digest,source_sha,run_id,run_attempt,actor_id,repository_id,owner_id,source_ref,state,total_bytes,token_hash,created_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,'uploading',?,?,?,?
      WHERE (SELECT COALESCE(SUM(total_bytes),0) FROM deployments WHERE state='ready' OR expires_at > ?) + ? <= ?
      AND (SELECT COUNT(*) FROM deployments WHERE state='uploading' AND expires_at > ?) < ?
      AND (SELECT COUNT(*) FROM deployments WHERE created_at > ?) < ?`,
    )
      .bind(
        id,
        key,
        digest,
        claims.sha,
        claims.run_id,
        claims.run_attempt,
        claims.actor_id,
        claims.repository_id,
        claims.repository_owner_id,
        claims.ref,
        inventory.totalBytes,
        tokenHash,
        created,
        created + 86400,
        created,
        inventory.totalBytes,
        limits.authorBytes,
        created,
        limits.activeSessions,
        created - 86400,
        limits.startsPerDay,
      )
      .run()
    if (!result.meta.changes)
      fail(429, 'Upload quota reached or concurrent start; retry later')
  } else {
    if (existing.source_sha !== claims.sha) fail(409, 'Workflow source changed')
    await c.env.DB.prepare('UPDATE deployments SET token_hash = ? WHERE id = ?')
      .bind(tokenHash, id)
      .run()
  }
  // Replaying the same OIDC exchange repairs an interrupted initial file-map write.
  if (existing?.state !== 'ready')
    await c.env.DB.batch(
      inventory.files.map((file, index) =>
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO upload_files
    (deployment_id,id,path,size,sha256,media_type) VALUES (?,?,?,?,?,?)`,
        ).bind(
          id,
          String(index),
          file.path,
          file.size,
          file.sha256,
          file.mediaType,
        ),
      ),
    )
  const row = await c.env.DB.prepare('SELECT * FROM deployments WHERE id = ?')
    .bind(id)
    .first<Deployment>()
  if (!row) throw new Error('Deployment creation failed')
  return c.json({ ...(await receipt(c, row)), credential }, 201)
})
api.get('/:id', async (c) => c.json(await receipt(c, await deployment(c))))
api.put('/:id/files/:fileId', async (c) => {
  const row = await deployment(c)
  if (row.state !== 'uploading') fail(409, 'Ready deployment is immutable')
  const file = await c.env.DB.prepare(
    'SELECT * FROM upload_files WHERE deployment_id = ? AND id = ?',
  )
    .bind(row.id, c.req.param('fileId'))
    .first<FileRow>()
  if (!file) fail(404, 'Unknown upload file')
  if (file.object_key) return c.json({ received: true, id: file.id })
  const lease = crypto.randomUUID()
  const acquired = await c.env.DB.prepare(
    `UPDATE deployments SET lease_id=?,lease_until=?
    WHERE id=? AND state='uploading' AND (lease_id IS NULL OR lease_until <= ?)`,
  )
    .bind(lease, now() + 120, row.id, now())
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
    const stored = await c.env.DB.prepare(
      `UPDATE upload_files SET object_key=? WHERE deployment_id=? AND id=?
      AND EXISTS (SELECT 1 FROM deployments WHERE id=? AND state='uploading' AND lease_id=? AND lease_until>?)`,
    )
      .bind(key, row.id, file.id, row.id, lease, now())
      .run()
    if (!stored.meta.changes) {
      await c.env.UPLOADS.delete(key)
      fail(409, 'Receive lease expired; retry')
    }
    return c.json({ received: true, id: file.id })
  } finally {
    await c.env.DB.prepare(
      'UPDATE deployments SET lease_id=NULL,lease_until=NULL WHERE id=? AND lease_id=?',
    )
      .bind(row.id, lease)
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
  const result = await c.env.DB.prepare(
    `UPDATE deployments SET state='ready',ready_at=?
    WHERE id=? AND state='uploading' AND (lease_id IS NULL OR lease_until<=?)
    AND EXISTS (SELECT 1 FROM upload_files WHERE deployment_id=? AND path='index.html')
    AND NOT EXISTS (SELECT 1 FROM upload_files WHERE deployment_id=? AND object_key IS NULL)`,
  )
    .bind(now(), row.id, now(), row.id, row.id)
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
  const file = await c.env.DB.prepare(
    'SELECT * FROM upload_files WHERE deployment_id=? AND path=?',
  )
    .bind(row.id, decodeURIComponent(path ?? ''))
    .first<FileRow>()
  if (!file?.object_key) fail(404, 'File not found')
  const object = await c.env.UPLOADS.get(file.object_key)
  if (!object) fail(404, 'Stored file not found')
  return new Response(object.body, {
    headers: {
      'Content-Type': file.media_type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:",
      'Content-Disposition': 'inline',
    },
  })
})
api.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status)
  console.error(JSON.stringify({ event: 'upload_api_error', name: error.name }))
  return c.json({ error: 'Upload service failed; retry the request' }, 500)
})
export { api as uploadsApi }
