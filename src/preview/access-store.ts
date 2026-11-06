import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import { hashToken } from '../auth/owner-session'
import { contentSessions, decks, deployments, uploadFiles } from '../db/schema'
import type { AccessFacts } from './access'

const sessionSchema = z
  .object({ expiresAt: z.number().int(), hardExpiresAt: z.number().int() })
  .optional()

/**
 * Reads, in one batch, whether the deployment is public and whether the
 * presented session is the allowed owner's live session for it. Both read
 * the deck's current state, never a cached decision.
 */
export async function readAccessFacts(
  database: D1Database,
  input: Readonly<{
    deploymentId: string
    sessionToken: string | null
    allowedOwnerId: string
    now: number
  }>,
): Promise<AccessFacts & { sessionHash: string | null }> {
  const { deploymentId, sessionToken, allowedOwnerId, now } = input
  const sessionHash = sessionToken ? await hashToken(sessionToken) : null
  const db = drizzle(database)
  const [publicRows, sessionRows] = await db.batch([
    db
      .select({ id: deployments.id })
      .from(deployments)
      .innerJoin(decks, eq(decks.public_deployment_id, deployments.id))
      .where(
        and(
          eq(deployments.id, deploymentId),
          eq(deployments.deck_id, decks.id),
          eq(deployments.state, 'ready'),
          isNull(decks.deleted_at),
        ),
      ),
    db
      .select({
        expiresAt: contentSessions.expires_at,
        hardExpiresAt: contentSessions.hard_expires_at,
      })
      .from(contentSessions)
      .innerJoin(deployments, eq(deployments.id, contentSessions.deployment_id))
      .innerJoin(decks, eq(decks.id, deployments.deck_id))
      .where(
        and(
          eq(contentSessions.token_hash, sessionHash ?? ''),
          eq(contentSessions.deployment_id, deploymentId),
          eq(contentSessions.owner_user_id, allowedOwnerId),
          eq(decks.owner_user_id, allowedOwnerId),
          eq(deployments.state, 'ready'),
          isNull(decks.deleted_at),
          gt(contentSessions.expires_at, now),
        ),
      ),
  ])
  return {
    isPublic: publicRows.length > 0,
    session: sessionSchema.parse(sessionRows[0]) ?? null,
    presentedSession: sessionToken !== null,
    sessionHash,
  }
}

/** Extends a session, never shortening one renewed concurrently. */
export async function renewSession(
  database: D1Database,
  sessionHash: string,
  expiresAt: number,
) {
  await drizzle(database)
    .update(contentSessions)
    .set({ expires_at: expiresAt })
    .where(
      and(
        eq(contentSessions.token_hash, sessionHash),
        sql`${contentSessions.expires_at} < ${expiresAt}`,
        sql`${contentSessions.hard_expires_at} >= ${expiresAt}`,
      ),
    )
    .run()
}

const fileSchema = z
  .object({
    objectKey: z.string(),
    mediaType: z.string(),
    sha256: z.string(),
  })
  .optional()

/** The stored object of a received file of the deployment. */
export async function readDeployedFile(
  database: D1Database,
  deploymentId: string,
  path: string,
) {
  const row = await drizzle(database)
    .select({
      objectKey: uploadFiles.object_key,
      mediaType: uploadFiles.media_type,
      sha256: uploadFiles.sha256,
    })
    .from(uploadFiles)
    .where(
      and(
        eq(uploadFiles.deployment_id, deploymentId),
        eq(uploadFiles.path, path),
        sql`${uploadFiles.object_key} IS NOT NULL`,
      ),
    )
    .get()
  return fileSchema.parse(row) ?? null
}
