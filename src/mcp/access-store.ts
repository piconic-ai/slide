import { and, eq, gt, isNull, lt, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { mcpGrants } from '../db/schema'

/** How stale the day a grant was last used may get before it is rewritten. */
export const LAST_USED_STEP_SECONDS = 60 * 60

export type Grant = Readonly<{
  id: string
  clientId: string
  ownerUserId: string
}>

/**
 * The grant whose access token has this hash and has not expired, or null.
 * A grant the author ended has no row, so its token stops at once.
 */
export async function readGrant(
  database: D1Database,
  accessTokenHash: string,
  now: number,
): Promise<Grant | null> {
  const row = await drizzle(database)
    .select({
      id: mcpGrants.id,
      clientId: mcpGrants.client_id,
      ownerUserId: mcpGrants.owner_user_id,
    })
    .from(mcpGrants)
    .where(
      and(
        eq(mcpGrants.access_token_hash, accessTokenHash),
        gt(mcpGrants.access_expires_at, now),
      ),
    )
    .get()
  return row ?? null
}

/**
 * Notes that the grant was used now. Written at most once per step, so a
 * busy agent does not write D1 on every request.
 */
export async function touchGrant(
  database: D1Database,
  id: string,
  now: number,
): Promise<void> {
  await drizzle(database)
    .update(mcpGrants)
    .set({ last_used_at: now })
    .where(
      and(
        eq(mcpGrants.id, id),
        or(
          isNull(mcpGrants.last_used_at),
          lt(mcpGrants.last_used_at, now - LAST_USED_STEP_SECONDS),
        ),
      ),
    )
}
