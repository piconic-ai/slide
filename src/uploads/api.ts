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
  type UploadSource,
} from '../db/schema'
import {
  digestUploadInventory,
  MAX_INVENTORY_METADATA_BYTES,
  parseInventoryStructure,
  type UploadInventory,
} from './inventory'
import { parseUploadLimits, type UploadLimits } from './limits'
import { isAuthor, parseAuthors } from '../auth/authors'
import { currentOwner, SuspendedOwnerError } from '../auth/owner-middleware'
import { hasSignIn, type Owner } from '../auth/owner-session'
import { deckIdSchema, type DeckId, type DeckSlug } from '../decks/binding'
import { freeSlug, slugBase, type SlideName } from '../decks/slug-name'
import {
  countLiveDecks,
  readDeckOwner,
  readOwnerSlugs,
  resolveDeck,
} from '../decks/store'
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
  expireIdleSessions,
  insertDeckWithSession,
  insertSessionWithinQuota,
  readQuotaUsage,
  type NewSession,
} from './start-store'
import { checkStoredObject, hexDigest } from './stored-objects'
import { coverPathOf } from './cover'
import { descriptionOf } from './description'
import { TITLE_SCAN_BYTES, titleOf } from './title'
import { recordCitations } from '../reactions/citation-store'
import {
  isOwnOrigin,
  newSlideKey,
  parseStartRequest,
  versionKey,
  type UploadAttempt,
} from './start-request'
import { readSuspension } from '../publication/suspension-store'

const api = new Hono<{ Bindings: Env }>()
type UploadContext = Context<{ Bindings: Env }>
/**
 * What starting an upload reads of a request: the bindings, and the URL the
 * links in a receipt are made against. Any route's context fits.
 */
type UploadScope = Readonly<{ env: Env; req: Readonly<{ url: string }> }>
const now = () => Math.floor(Date.now() / 1000)
const uploadLimits = (c: UploadScope) => parseUploadLimits(c.env.UPLOAD_LIMITS)
type UploadErrorCode =
  | SessionErrorCode
  | 'immutable'
  | 'start_rejected'
  | 'upload_busy'
  | 'inventory_conflict'
  | 'deck_limit'
  | 'invitation_only'
type UploadStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429
class UploadError extends HTTPException {
  constructor(
    status: UploadStatus,
    message: string,
    readonly code?: UploadErrorCode,
    readonly details: Readonly<Record<string, string>> = {},
  ) {
    super(status, { message })
  }
}
function fail(
  status: UploadStatus,
  message: string,
  code?: UploadErrorCode,
  details?: Readonly<Record<string, string>>,
): never {
  throw new UploadError(status, message, code, details)
}
const sessionErrors: Readonly<
  Record<SessionErrorCode | 'immutable', readonly [401 | 409, string]>
> = {
  // Only an expired credential can be fixed by starting the attempt again.
  credential_expired: [
    401,
    'Upload credential expired; start again with the same attempt',
  ],
  immutable: [409, 'Ready deployment is immutable'],
  session_expired: [409, 'Upload session expired; start a new attempt'],
  session_failed: [409, 'Upload session failed; start a new attempt'],
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
  if (!row.deck_id || (await uploadingOwner(c, row.deck_id)) === null)
    failClosedDeck()
  return row
}
function failClosedDeck(): never {
  return fail(403, 'Uploads to this slide are not accepted')
}
/**
 * The owner of a deck that may receive files, or null: the deck is not
 * being deleted, and its owner is a registered author who is not suspended.
 * Checked on every request, so removing an author, suspending them or
 * deleting the deck also stops a credential issued before.
 */
async function uploadingOwner(
  c: UploadScope,
  deckId: string,
): Promise<string | null> {
  const deck = await readDeckOwner(c.env.DB, deckId)
  return deck !== null &&
    !deck.deleted &&
    (await isActiveAuthor(c, deck.ownerUserId))
    ? deck.ownerUserId
    : null
}
/** Whether the person is a registered author who is not suspended. */
async function isActiveAuthor(
  c: UploadScope,
  userId: string,
): Promise<boolean> {
  return (
    isAuthor(parseAuthors(c.env.AUTHOR_GITHUB_IDS), userId) &&
    (await readSuspension(c.env.DB, userId)) === null
  )
}
async function files(c: UploadScope, id: string) {
  return drizzle(c.env.DB)
    .select()
    .from(uploadFiles)
    .where(eq(uploadFiles.deployment_id, id))
    .orderBy(uploadFiles.path)
    .all()
    .then((result) => uploadFileRowSchema.array().parse(result))
}
async function receipt(c: UploadScope, row: Deployment) {
  return {
    deploymentId: row.id,
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
      'Invalid upload attempt; send { "attempt": "<16 to 64 URL-safe characters>" }',
    )
  }
}
async function requestStart(request: Request) {
  try {
    const bytes = await readBounded(request, MAX_INVENTORY_METADATA_BYTES)
    const json: unknown = JSON.parse(new TextDecoder().decode(bytes))
    const start = startRequest(json)
    return {
      attempt: start.attempt,
      name: start.name,
      inventory: parseInventoryStructure(start.inventory),
    }
  } catch (error) {
    return invalidInventory(error)
  }
}
function failConcurrentStart(): never {
  return fail(429, 'Concurrent start; retry', 'upload_busy')
}
/**
 * Refuses a start for a reason that retrying the attempt cannot fix. For a
 * new version the refusal is recorded in the slide's history when it can
 * be; a start that would have made a new slide leaves nothing behind.
 */
async function rejectStart(
  db: DrizzleD1Database,
  session: NewSession,
  reason: StartRejection,
  limits: UploadLimits,
  record: boolean,
): Promise<never> {
  // The refusal is reported even when it cannot be recorded.
  const recorded =
    record && (await insertRejectedStart(db, session, reason, limits))
  if (record && !recorded && (await deploymentExists(db, session.key)))
    failConcurrentStart()
  const { status, message } = startRejectionResponse(reason)
  return fail(
    status,
    message,
    'start_rejected',
    recorded ? { reason, deploymentId: session.id } : { reason },
  )
}
/**
 * Explains a session insert that every condition together refused. It
 * returns only when trying the insert again is worth it: the refusal was for
 * uploads still open, and some were given up. The newest start wins over
 * uploads nobody is sending any more, since a sender stopped halfway cannot
 * be continued: only it knew its attempt.
 */
async function settleRefusedSession(
  db: DrizzleD1Database,
  session: NewSession,
  limits: UploadLimits,
  record: boolean,
): Promise<void> {
  // A concurrent request for the same attempt won; a retry replays it.
  if (await deploymentExists(db, session.key)) failConcurrentStart()
  const usage = await readQuotaUsage(db, session.ownerUserId, session.created)
  const decision = quotaDecision(usage, session.inventory.totalBytes, limits)
  if (decision.kind === 'rejected')
    return rejectStart(db, session, decision.reason, limits, record)
  if (
    decision.kind === 'busy' &&
    (await expireIdleSessions(db, session.ownerUserId, session.created)) > 0
  )
    return
  return fail(
    429,
    decision.kind === 'busy'
      ? 'Another upload is in progress; retry later'
      : 'Concurrent start; retry',
    'upload_busy',
  )
}
async function createSession(
  db: DrizzleD1Database,
  session: NewSession,
  limits: UploadLimits,
) {
  // Inventory limits apply only when a session is created.
  const refused = inventoryRejection(session.inventory, limits)
  if (refused) return rejectStart(db, session, refused, limits, true)
  if (await insertSessionWithinQuota(db, session, limits)) return
  await settleRefusedSession(db, session, limits, true)
  if (await insertSessionWithinQuota(db, session, limits)) return
  return failConcurrentStart()
}
/** How often a new slide's name is picked again when another start took it. */
const SLUG_ATTEMPTS = 3
/**
 * Makes a new slide with the session of its first upload, and returns the
 * slide. Its name comes from what the sender knows of it; a start that is
 * refused makes no slide.
 */
async function createSlide(
  c: UploadScope,
  db: DrizzleD1Database,
  session: Omit<NewSession, 'deckId'>,
  name: SlideName,
  limits: UploadLimits,
): Promise<UploadDeck> {
  const owner = session.ownerUserId
  const refused = inventoryRejection(session.inventory, limits)
  const base = slugBase(name)
  for (let attempt = 1; attempt <= SLUG_ATTEMPTS; attempt++) {
    const deck = {
      id: deckIdSchema.parse(crypto.randomUUID()),
      slug: freeSlug(base, await readOwnerSlugs(c.env.DB, owner)),
    }
    const created = { ...session, deckId: deck.id }
    if (refused) return rejectStart(db, created, refused, limits, false)
    const result = await insertDeckWithSession(db, deck, created, limits)
    if (result === 'created') return deck
    if (result === 'no_session') {
      // Returns when uploads left open were given up; the next round
      // tries again.
      await settleRefusedSession(db, created, limits, false)
      continue
    }
    // No slide was made: the owner holds as many as allowed, or another
    // start took the name meanwhile and the next round picks another.
    if ((await countLiveDecks(c.env.DB, owner)) >= limits.decks)
      fail(
        409,
        'You have as many slides as one account may hold; delete one to add another',
        'deck_limit',
      )
  }
  return failConcurrentStart()
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
async function readDeployment(c: UploadScope, id: string) {
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
  c: UploadScope,
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
type UploadDeck = Readonly<{ id: DeckId; slug: DeckSlug }>
/** What an upload is for: a new version of a slide, or a new slide. */
export type UploadTarget =
  | Readonly<{ kind: 'version'; deck: UploadDeck }>
  | Readonly<{ kind: 'new'; name: SlideName }>
export type UploadStart = Readonly<{
  /** The author. The caller has already checked who is asking. */
  ownerUserId: string
  /** Where the files are sent from: a browser, or an agent through MCP. */
  source: UploadSource
  target: UploadTarget
  attempt: UploadAttempt
  inventory: UploadInventory
}>

/**
 * The slide an attempt at a new slide made before, when the attempt is
 * started again. Null when the slide stopped taking uploads.
 */
async function slideOfAttempt(
  c: UploadScope,
  existing: Deployment,
  ownerUserId: string,
): Promise<UploadDeck | null> {
  if (!existing.deck_id) return null
  const deck = await readDeckOwner(c.env.DB, existing.deck_id)
  return deck && (await uploadingOwner(c, existing.deck_id)) === ownerUserId
    ? { id: deckIdSchema.parse(existing.deck_id), slug: deck.slug }
    : null
}

/**
 * Starts receiving a new version of a slide or a new slide, or continues
 * the upload the same attempt started before. Returns the receipt with a
 * fresh credential; a credential issued earlier for the attempt stops
 * working.
 *
 * Who is asking is the caller's to check: the browser route checks the
 * author's session, and another entry, such as MCP, checks its own grant.
 * That the owner they name is a registered author who is not suspended, and
 * owns the slide that gets a new version, is checked here with the limits
 * and quotas, so these are the same for every entry.
 */
export async function startUpload(c: UploadScope, start: UploadStart) {
  const { target, inventory, ownerUserId } = start
  const allowed =
    target.kind === 'version'
      ? (await uploadingOwner(c, target.deck.id)) === ownerUserId
      : await isActiveAuthor(c, ownerUserId)
  if (!allowed) failClosedDeck()
  // Invalid configuration fails every start, including replays.
  const limits = uploadLimits(c)
  const digest = await digestUploadInventory(inventory)
  const key =
    target.kind === 'version'
      ? versionKey(target.deck.id, start.attempt)
      : newSlideKey(ownerUserId, start.attempt)
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
      'This attempt already has a different inventory; use a new attempt',
      'inventory_conflict',
    )
  const id = existing?.id ?? crypto.randomUUID()
  const credential = `${crypto.randomUUID()}.${crypto.randomUUID()}`
  const tokenHash = await sha256(new TextEncoder().encode(credential))
  const created = now()
  const deck = existing
    ? await resumedDeck(c, start, existing, tokenHash, limits, created)
    : await startedDeck(c, db, start, limits, {
        id,
        key,
        digest,
        ownerUserId,
        source: start.source,
        inventory,
        tokenHash,
        created,
      })
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
  const row = await readDeployment(c, id)
  if (!row) throw new Error('Deployment creation failed')
  return {
    ...(await receipt(c, row)),
    credential,
    slug: deck.slug,
    manageUrl: new URL(`/slides/${deck.slug}`, c.req.url).href,
  }
}
/** Creates the session of a first start, and the slide when it is new. */
async function startedDeck(
  c: UploadScope,
  db: DrizzleD1Database,
  start: UploadStart,
  limits: UploadLimits,
  session: Omit<NewSession, 'deckId'>,
): Promise<UploadDeck> {
  const { target } = start
  if (target.kind === 'new')
    return createSlide(c, db, session, target.name, limits)
  await createSession(db, { ...session, deckId: target.deck.id }, limits)
  return target.deck
}
/** Renews the credential of an attempt started before, and names its slide. */
async function resumedDeck(
  c: UploadScope,
  start: UploadStart,
  existing: Deployment,
  tokenHash: string,
  limits: UploadLimits,
  at: number,
): Promise<UploadDeck> {
  const deck =
    start.target.kind === 'version'
      ? start.target.deck
      : await slideOfAttempt(c, existing, start.ownerUserId)
  if (!deck) return failClosedDeck()
  await rotateCredential(c, existing, tokenHash, limits, at)
  return deck
}

/**
 * The author's own deck of this slug, not waiting to be purged. A slug
 * nobody has and a deck of someone else look the same.
 */
async function ownDeck(env: Env, ownerUserId: string, slug: string) {
  const deck = await resolveDeck(env.DB, ownerUserId, slug)
  if (!deck || deck.deleted) fail(404, 'Unknown slide')
  return deck
}
/**
 * A start is the only upload request the session cookie authorizes, so it
 * must come from a page of the service itself, whatever type it is sent
 * as. `hono/csrf` looks at the origin only for the types a form can send,
 * which a start is not.
 */
const ownOrigin: MiddlewareHandler = async (c, next) => {
  if (!isOwnOrigin(c.req.header('origin'), c.req.url))
    fail(403, 'Start uploads from the service’s own pages')
  await next()
}
/**
 * A start takes JSON alone: another origin cannot send that type without a
 * preflight this service never grants, which backs the origin check.
 */
const jsonOnly: MiddlewareHandler = async (c, next) => {
  if (!/^application\/json\b/i.test(c.req.header('content-type') ?? ''))
    fail(415, 'Send the upload start as application/json')
  await next()
}
/**
 * Lets a signed-in registered author through. Someone signed in who is not
 * registered, such as an author taken off the registration since, is told
 * the service is by invitation; anyone else is asked to sign in.
 */
const requireAuthor: MiddlewareHandler<{
  Bindings: Env
  Variables: { owner: Owner }
}> = async (c, next) => {
  const owner = await currentOwner(c)
  if (!owner) {
    if (await hasSignIn(c))
      fail(
        403,
        'Putting slides here is by invitation for now',
        'invitation_only',
      )
    return c.json({ error: 'Sign in as the owner' }, 401)
  }
  c.set('owner', owner)
  await next()
}
/** Starts or resumes an upload: of a new slide, or of a new version of one. */
export const deckUploadsApi = new Hono<{
  Bindings: Env
  Variables: { owner: Owner }
}>()
deckUploadsApi.use('*', noStore)
deckUploadsApi.post('/', ownOrigin, requireAuthor, jsonOnly, async (c) => {
  // Read before the body, so a misconfiguration is not blamed on it.
  uploadLimits(c)
  const { attempt, name, inventory } = await requestStart(c.req.raw)
  const started = await startUpload(c, {
    ownerUserId: c.get('owner').userId,
    source: 'browser',
    target: { kind: 'new', name },
    attempt,
    inventory,
  })
  return c.json(started, 201)
})
deckUploadsApi.post(
  '/:deck/uploads',
  ownOrigin,
  requireAuthor,
  jsonOnly,
  async (c) => {
    const owner = c.get('owner')
    const deck = await ownDeck(c.env, owner.userId, c.req.param('deck'))
    // Read before the body, so a misconfiguration is not blamed on it.
    uploadLimits(c)
    const { attempt, inventory } = await requestStart(c.req.raw)
    const started = await startUpload(c, {
      ownerUserId: owner.userId,
      source: 'browser',
      target: { kind: 'version', deck },
      attempt,
      inventory,
    })
    return c.json(started, 201)
  },
)
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
const NO_ENTRY_TEXT = { title: null, description: null, cover_path: null }
/** The path if the deployment has a file there, so a cover always loads. */
async function uploadedPath(c: UploadContext, id: string, path: string | null) {
  if (path === null) return null
  const file = await drizzle(c.env.DB)
    .select({ path: uploadFiles.path })
    .from(uploadFiles)
    .where(and(eq(uploadFiles.deployment_id, id), eq(uploadFiles.path, path)))
    .get()
  return file?.path ?? null
}
/**
 * The title, description and cover of a deployment's verified index.html.
 * They only describe the deck to readers, so a storage error leaves them
 * null instead of failing.
 */
async function readEntryText(c: UploadContext, id: string) {
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
  if (!entry?.key) return NO_ENTRY_TEXT
  let head: string
  try {
    const object = await c.env.UPLOADS.get(entry.key, {
      range: { offset: 0, length: TITLE_SCAN_BYTES },
    })
    if (!object) return NO_ENTRY_TEXT
    head = await object.text()
  } catch {
    return NO_ENTRY_TEXT
  }
  return {
    title: titleOf(head),
    description: descriptionOf(head),
    // A failing D1 read fails the finalize, which is retried, as above.
    cover_path: await uploadedPath(c, id, coverPathOf(head)),
  }
}
api.post('/:id/finalize', async (c) => {
  const row = await deployment(c)
  if (row.state === 'ready') return c.json(await receipt(c, row))
  assertWritable(row)
  const missing = await unverifiedFiles(c, row.id)
  if (missing.length) {
    // A concurrent finalize may have made the deployment ready meanwhile.
    const current = await readDeployment(c, row.id)
    if (current?.state === 'ready') return c.json(await receipt(c, current))
    return c.json(
      {
        error: 'Files are missing',
        code: 'files_missing',
        missing: missing.map((file) => file.path),
      },
      409,
    )
  }
  const entryText = await readEntryText(c, row.id)
  // Before the deployment is ready, so a retried finalize records them too.
  await recordCitations(c.env, row.id)
  const db = drizzle(c.env.DB)
  const result = await db
    .update(deployments)
    .set({ state: 'ready', ready_at: now(), ...entryText })
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
  if (ready?.state === 'ready') return c.json(await receipt(c, ready))
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
const handleUploadError: ErrorHandler = (error, c) => {
  if (error instanceof SuspendedOwnerError)
    return c.json({ error: 'Account suspended' }, 403)
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
