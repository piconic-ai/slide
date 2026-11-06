import { and, sql, type SQL } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { z } from 'zod'
import { deployments } from '../db/schema'
import type { UploadInventory } from './inventory'
import { START_WINDOW_SECONDS, type UploadLimits } from './limits'
import type { GitHubClaims } from './oidc'
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
  claims: GitHubClaims
  inventory: UploadInventory
  tokenHash: string
  created: number
}>

// Each quota term is defined once and used both as an insert condition and to
// explain a refused insert.
const reservedBytes = (now: number) =>
  sql<number>`(SELECT COALESCE(SUM(${deployments.total_bytes}), 0) FROM ${deployments}
    WHERE ${deployments.state} = 'ready'
      OR (${deployments.state} = 'uploading' AND ${deployments.expires_at} > ${now}))`
const activeSessions = (now: number) =>
  sql<number>`(SELECT COUNT(*) FROM ${deployments}
    WHERE ${deployments.state} = 'uploading' AND ${deployments.expires_at} > ${now})`
// Refused starts are recorded for history but do not consume the start quota.
const startsInWindow = (now: number) =>
  sql<number>`(SELECT COUNT(*) FROM ${deployments}
    WHERE ${deployments.created_at} > ${now - START_WINDOW_SECONDS}
      AND NOT (${deployments.state} = 'failed'
        AND ${deployments.failure_reason} IN (${sql.join(
          startRejections.map((reason) => sql`${reason}`),
          sql`, `,
        )})))`

const usageSchema = z.object({
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
) {
  const { claims, created } = session
  return {
    id: sql<string>`${session.id}`.as('id'),
    idempotency_key: sql<string>`${session.key}`.as('idempotency_key'),
    inventory_digest: sql<string>`${session.digest}`.as('inventory_digest'),
    source_sha: sql<string>`${claims.sha}`.as('source_sha'),
    run_id: sql<string>`${claims.run_id}`.as('run_id'),
    run_attempt: sql<string>`${claims.run_attempt}`.as('run_attempt'),
    actor_id: sql<string>`${claims.actor_id}`.as('actor_id'),
    repository_id: sql<string>`${claims.repository_id}`.as('repository_id'),
    owner_id: sql<string>`${claims.repository_owner_id}`.as('owner_id'),
    source_ref: sql<string>`${claims.ref}`.as('source_ref'),
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
  }
}

/** Inserts an uploading session only if every quota allows it. */
export async function insertSessionWithinQuota(
  db: DrizzleD1Database,
  session: NewSession,
  limits: UploadLimits,
): Promise<boolean> {
  const { created, inventory } = session
  const { expiresAt, credentialExpiresAt } = newSessionExpiry(created, limits)
  const result = await db
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
            sql`${reservedBytes(created)} + ${inventory.totalBytes} <= ${limits.authorBytes}`,
            sql`${activeSessions(created)} < ${limits.activeSessions}`,
            sql`${startsInWindow(created)} < ${limits.startsPerDay}`,
          ),
        ),
    )
    .onConflictDoNothing()
    .run()
  return result.meta.changes > 0
}

/** Records a refused start as a failed deployment that holds no quota. */
export async function insertRejectedStart(
  db: DrizzleD1Database,
  session: NewSession,
  reason: StartRejection,
  credentialSeconds: number,
): Promise<boolean> {
  // The credential only reads the receipt, so it ends with its own lifetime.
  const expiresAt = session.created + credentialSeconds
  const result = await db
    .insert(deployments)
    .select(
      db
        .select(
          sessionColumns(session, sql`'failed'`, expiresAt, expiresAt, reason),
        )
        .from(sql`(SELECT 1)`)
        // SQLite needs a WHERE clause to parse INSERT ... SELECT ... ON CONFLICT.
        .where(sql`1`),
    )
    .onConflictDoNothing()
    .run()
  return result.meta.changes > 0
}

export async function readQuotaUsage(
  db: DrizzleD1Database,
  now: number,
): Promise<QuotaUsage> {
  const row = await db
    .select({
      reservedBytes: reservedBytes(now),
      activeSessions: activeSessions(now),
      startsInWindow: startsInWindow(now),
    })
    .from(sql`(SELECT 1)`)
    .get()
  return usageSchema.parse(row)
}
