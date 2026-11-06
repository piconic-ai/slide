import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { hashToken, randomToken } from '../auth/owner-session'
import {
  contentSessions,
  decks,
  deployments,
  previewLaunches,
} from '../db/schema'
import { LAUNCH_SECONDS, newSessionTimes } from './lifetime'

/** The deployment is ready and belongs to a deck the owner has. */
const ownedReadyDeployment = (deploymentId: string, ownerUserId: string) =>
  sql`EXISTS (SELECT 1 FROM ${deployments}
    JOIN ${decks} ON ${decks.id} = ${deployments.deck_id}
    WHERE ${deployments.id} = ${deploymentId}
      AND ${deployments.state} = 'ready'
      AND ${decks.owner_user_id} = ${ownerUserId}
      AND ${decks.deleted_at} IS NULL)`

/**
 * Issues a one-time launch token for owner-only viewing of a ready
 * deployment of the owner's deck. Returns null when the deployment is not
 * one. Expired launches are removed opportunistically.
 */
export async function issueLaunch(
  database: D1Database,
  input: Readonly<{
    deckId: string
    deploymentId: string
    ownerUserId: string
    now: number
  }>,
): Promise<string | null> {
  const { deckId, deploymentId, ownerUserId, now } = input
  const token = randomToken()
  const db = drizzle(database)
  const [, inserted] = await db.batch([
    db.delete(previewLaunches).where(lte(previewLaunches.expires_at, now)),
    db.insert(previewLaunches).select(
      db
        .select({
          token_hash: sql<string>`${await hashToken(token)}`.as('token_hash'),
          deployment_id: sql<string>`${deploymentId}`.as('deployment_id'),
          owner_user_id: sql<string>`${ownerUserId}`.as('owner_user_id'),
          created_at: sql<number>`${now}`.as('created_at'),
          expires_at: sql<number>`${now + LAUNCH_SECONDS}`.as('expires_at'),
          consumed_at: sql<null>`NULL`.as('consumed_at'),
          session_hash: sql<null>`NULL`.as('session_hash'),
        })
        .from(deployments)
        .where(
          and(
            eq(deployments.id, deploymentId),
            eq(deployments.deck_id, deckId),
            ownedReadyDeployment(deploymentId, ownerUserId),
          ),
        ),
    ),
  ])
  return inserted.meta.changes > 0 ? token : null
}

/**
 * Consumes a launch token on the deployment's own origin and opens a
 * viewing session for its owner. The launch must be unused, unexpired, for
 * this deployment, and still owned; otherwise null. A token used twice,
 * even concurrently, opens at most one session.
 */
export async function consumeLaunch(
  database: D1Database,
  input: Readonly<{
    token: string
    deploymentId: string
    allowedOwnerId: string
    now: number
  }>,
): Promise<string | null> {
  const { token, deploymentId, allowedOwnerId, now } = input
  const session = randomToken()
  const sessionHash = await hashToken(session)
  const times = newSessionTimes(now)
  const tokenHash = await hashToken(token)
  const db = drizzle(database)
  // One transaction: the session row exists only for the claim that wrote
  // its hash, so a concurrent second claim inserts nothing.
  const [, opened] = await db.batch([
    db
      .update(previewLaunches)
      .set({ consumed_at: now, session_hash: sessionHash })
      .where(
        and(
          eq(previewLaunches.token_hash, tokenHash),
          eq(previewLaunches.deployment_id, deploymentId),
          eq(previewLaunches.owner_user_id, allowedOwnerId),
          isNull(previewLaunches.consumed_at),
          gt(previewLaunches.expires_at, now),
          ownedReadyDeployment(deploymentId, allowedOwnerId),
        ),
      ),
    db.insert(contentSessions).select(
      db
        .select({
          token_hash: previewLaunches.session_hash,
          deployment_id: previewLaunches.deployment_id,
          owner_user_id: previewLaunches.owner_user_id,
          created_at: sql<number>`${times.createdAt}`.as('created_at'),
          expires_at: sql<number>`${times.expiresAt}`.as('expires_at'),
          hard_expires_at: sql<number>`${times.hardExpiresAt}`.as(
            'hard_expires_at',
          ),
        })
        .from(previewLaunches)
        .where(
          and(
            eq(previewLaunches.token_hash, tokenHash),
            eq(previewLaunches.session_hash, sessionHash),
          ),
        ),
    ),
  ])
  if (!opened.meta.changes) return null
  return session
}

/** Removes expired launches and sessions. */
export async function sweepPreviews(database: D1Database, now: number) {
  const db = drizzle(database)
  await db.batch([
    db.delete(previewLaunches).where(lte(previewLaunches.expires_at, now)),
    db
      .delete(contentSessions)
      .where(
        or(
          lte(contentSessions.expires_at, now),
          lte(contentSessions.hard_expires_at, now),
        ),
      ),
  ])
}
