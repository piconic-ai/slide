import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { z } from 'zod'
import { decks, deployments, type UploadSource } from '../db/schema'
import type { UploadInventory } from './inventory'
import { START_WINDOW_SECONDS, type UploadLimits } from './limits'
import {
  startRejections,
  type QuotaUsage,
  type StartRejection,
} from './rejections'
import { newSessionExpiry } from './session'

export type NewSession = Readonly<{
  id: string
  key: string
  digest: string
  deckId: string
  /** The deck owner, whose account quotas the session counts against. */
  ownerUserId: string
  /** Where the files are sent from. */
  source: UploadSource
  inventory: UploadInventory
  tokenHash: string
  created: number
}>

// Each quota term is defined once and used both as an insert condition and to
// explain a refused insert. Every term counts only the owner's decks.
const ownedBy = (owner: string) =>
  sql`${deployments.deck_id} IN (SELECT ${decks.id} FROM ${decks}
    WHERE ${decks.owner_user_id} = ${owner})`
const storedBytes = (owner: string) =>
  sql<number>`(SELECT COALESCE(SUM(${deployments.total_bytes}), 0) FROM ${deployments}
    WHERE ${deployments.state} = 'ready' AND ${ownedBy(owner)})`
const reservedBytes = (owner: string, now: number) =>
  sql<number>`(SELECT COALESCE(SUM(${deployments.total_bytes}), 0) FROM ${deployments}
    WHERE ${deployments.state} = 'uploading' AND ${deployments.expires_at} > ${now}
      AND ${ownedBy(owner)})`
const activeSessions = (owner: string, now: number) =>
  sql<number>`(SELECT COUNT(*) FROM ${deployments}
    WHERE ${deployments.state} = 'uploading' AND ${deployments.expires_at} > ${now}
      AND ${ownedBy(owner)})`
// Start rejection reasons are written only by insertRejectedStart, so they
// identify refused starts.
const isRefusedStart = sql`(${deployments.state} = 'failed'
  AND ${deployments.failure_reason} IN (${sql.join(
    startRejections.map((reason) => sql`${reason}`),
    sql`, `,
  )}))`
// Refused starts are recorded for history but do not consume the start quota.
const startsInWindow = (owner: string, now: number) =>
  sql<number>`(SELECT COUNT(*) FROM ${deployments}
    WHERE ${deployments.created_at} > ${now - START_WINDOW_SECONDS}
      AND NOT ${isRefusedStart} AND ${ownedBy(owner)})`
const refusalsInWindow = (owner: string, now: number) =>
  sql<number>`(SELECT COUNT(*) FROM ${deployments}
    WHERE ${deployments.created_at} > ${now - START_WINDOW_SECONDS}
      AND ${isRefusedStart} AND ${ownedBy(owner)})`

const usageSchema = z.object({
  storedBytes: z.number().int().nonnegative(),
  reservedBytes: z.number().int().nonnegative(),
  activeSessions: z.number().int().nonnegative(),
  startsInWindow: z.number().int().nonnegative(),
})

function sessionColumns(
  session: NewSession,
  state: SQL,
  expiresAt: number,
  credentialExpiresAt: number,
  failureReason: StartRejection | null,
  // A refused start never stores objects, so it needs no sweep.
  sweptAt: number | null = null,
) {
  const { created } = session
  return {
    id: sql<string>`${session.id}`.as('id'),
    idempotency_key: sql<string>`${session.key}`.as('idempotency_key'),
    inventory_digest: sql<string>`${session.digest}`.as('inventory_digest'),
    state: state.as('state'),
    total_bytes: sql<number>`${session.inventory.totalBytes}`.as('total_bytes'),
    token_hash: sql<string>`${session.tokenHash}`.as('token_hash'),
    created_at: sql<number>`${created}`.as('created_at'),
    expires_at: sql<number>`${expiresAt}`.as('expires_at'),
    credential_expires_at: sql<number>`${credentialExpiresAt}`.as(
      'credential_expires_at',
    ),
    lease_id: sql<null>`NULL`.as('lease_id'),
    lease_until: sql<null>`NULL`.as('lease_until'),
    ready_at: sql<null>`NULL`.as('ready_at'),
    failure_reason: sql<string | null>`${failureReason}`.as('failure_reason'),
    swept_at: sql<number | null>`${sweptAt}`.as('swept_at'),
    sweep_after: sql<null>`NULL`.as('sweep_after'),
    deck_id: sql<string>`${session.deckId}`.as('deck_id'),
    // Read from index.html when the upload becomes ready.
    title: sql<null>`NULL`.as('title'),
    description: sql<null>`NULL`.as('description'),
    cover_path: sql<null>`NULL`.as('cover_path'),
    source: sql<UploadSource>`${session.source}`.as('source'),
  }
}

/** The insert of an uploading session that takes effect only if every quota allows it. */
function sessionInsert(
  db: DrizzleD1Database,
  session: NewSession,
  limits: UploadLimits,
) {
  const { created, inventory, ownerUserId: owner } = session
  const { expiresAt, credentialExpiresAt } = newSessionExpiry(created, limits)
  return db
    .insert(deployments)
    .select(
      db
        .select(
          sessionColumns(
            session,
            sql`'uploading'`,
            expiresAt,
            credentialExpiresAt,
            null,
          ),
        )
        .from(sql`(SELECT 1)`)
        .where(
          and(
            sql`${storedBytes(owner)} + ${reservedBytes(owner, created)} + ${inventory.totalBytes} <= ${limits.authorBytes}`,
            sql`${activeSessions(owner, created)} < ${limits.activeSessions}`,
            sql`${startsInWindow(owner, created)} < ${limits.startsPerDay}`,
            // A start that passed its checks while the deck was being
            // deleted must not hold the owner's quota until the purge.
            sql`EXISTS (SELECT 1 FROM ${decks} WHERE ${decks.id} = ${session.deckId}
              AND ${decks.deleted_at} IS NULL)`,
          ),
        ),
    )
    .onConflictDoNothing()
}

/** Inserts an uploading session only if every quota allows it. */
export async function insertSessionWithinQuota(
  db: DrizzleD1Database,
  session: NewSession,
  limits: UploadLimits,
): Promise<boolean> {
  const result = await sessionInsert(db, session, limits).run()
  return result.meta.changes > 0
}

export type NewDeck = Readonly<{ id: string; slug: string }>

/**
 * Creates a slide together with the session of its first upload, or
 * neither. The slide is made only while the owner has fewer than
 * `limits.decks` live ones and no slide of that slug; the session only if
 * every quota allows it; and a slide left without a session is taken away
 * again, all in one batch.
 *
 * `no_deck` means the slide was not made (the limit, or the slug was taken
 * meanwhile), `no_session` that the session was refused.
 */
export async function insertDeckWithSession(
  db: DrizzleD1Database,
  deck: NewDeck,
  session: NewSession,
  limits: UploadLimits,
): Promise<'created' | 'no_deck' | 'no_session'> {
  const owner = session.ownerUserId
  const liveDecks = db.$count(
    decks,
    and(eq(decks.owner_user_id, owner), sql`${decks.deleted_at} IS NULL`),
  )
  // Drizzle's insert.select requires every column; this insert keeps the
  // schema defaults of the columns it leaves out.
  const createDeck = sql`
    INSERT INTO ${decks} (
      ${sql.identifier(decks.id.name)},
      ${sql.identifier(decks.slug.name)},
      ${sql.identifier(decks.owner_user_id.name)},
      ${sql.identifier(decks.created_at.name)}
    )
    SELECT ${deck.id}, ${deck.slug}, ${owner}, ${session.created}
    WHERE ${liveDecks} < ${limits.decks}
    ON CONFLICT DO NOTHING
  `
  const [made, started] = await db.batch([
    // Drizzle 0.45.4's D1 batch cannot bind SQLiteRaw parameters.
    // inlineParams escapes the literals for the parameterless batch path.
    db.run(createDeck.inlineParams()),
    sessionInsert(db, session, limits),
    db.delete(decks).where(
      and(
        eq(decks.id, deck.id),
        sql`NOT EXISTS (SELECT 1 FROM ${deployments}
          WHERE ${deployments.deck_id} = ${deck.id})`,
      ),
    ),
  ])
  if (started.meta.changes > 0) return 'created'
  return made.meta.changes > 0 ? 'no_session' : 'no_deck'
}

/**
 * Records a refused start as a failed deployment that holds no quota. Returns
 * false when the refusal cap is reached or the key already has a deployment.
 */
export async function insertRejectedStart(
  db: DrizzleD1Database,
  session: NewSession,
  reason: StartRejection,
  limits: UploadLimits,
): Promise<boolean> {
  // Nobody holds this credential; the row exists for the owner's history.
  const expiresAt = session.created + limits.credentialSeconds
  const result = await db
    .insert(deployments)
    .select(
      db
        .select(
          sessionColumns(
            session,
            sql`'failed'`,
            expiresAt,
            expiresAt,
            reason,
            session.created,
          ),
        )
        .from(sql`(SELECT 1)`)
        .where(
          sql`${refusalsInWindow(session.ownerUserId, session.created)} < ${limits.refusalsPerDay}`,
        ),
    )
    .onConflictDoNothing()
    .run()
  return result.meta.changes > 0
}

/**
 * Gives up the owner's uploads that are open but not receiving a file right
 * now, as their expiry would, and says how many. A sender that was stopped
 * halfway leaves such an upload behind with nobody to continue it, and it
 * would hold the owner's only session until it expired. An upload in the
 * middle of receiving a file holds a lease and is left alone.
 */
export async function expireIdleSessions(
  db: DrizzleD1Database,
  owner: string,
  now: number,
): Promise<number> {
  const result = await db
    .update(deployments)
    .set({
      state: 'expired',
      expires_at: now,
      lease_id: null,
      lease_until: null,
    })
    .where(
      and(
        eq(deployments.state, 'uploading'),
        ownedBy(owner),
        sql`(${deployments.lease_id} IS NULL OR ${deployments.lease_until} <= ${now})`,
      ),
    )
    .run()
  return result.meta.changes
}

export async function readQuotaUsage(
  db: DrizzleD1Database,
  owner: string,
  now: number,
): Promise<QuotaUsage> {
  const row = await db
    .select({
      storedBytes: storedBytes(owner),
      reservedBytes: reservedBytes(owner, now),
      activeSessions: activeSessions(owner, now),
      startsInWindow: startsInWindow(owner, now),
    })
    .from(sql`(SELECT 1)`)
    .get()
  return usageSchema.parse(row)
}

/** True when a deployment already exists for the idempotency key. */
export async function deploymentExists(
  db: DrizzleD1Database,
  key: string,
): Promise<boolean> {
  const row = await db
    .select({ id: deployments.id })
    .from(deployments)
    .where(eq(deployments.idempotency_key, key))
    .get()
  return row !== undefined
}
