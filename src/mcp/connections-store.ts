import { and, desc, eq, gt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { mcpClients, mcpGrants } from '../db/schema'

/** One agent the author connected, as the settings list it. */
export type Connection = Readonly<{
  id: string
  /** The name the agent registered itself with. */
  name: string
  connectedAt: number
  lastUsedAt: number | null
}>

/**
 * The author's live connections, the newest first. A connection whose
 * refresh token has run out can no longer be used and is left out.
 */
export async function listConnections(
  database: D1Database,
  ownerUserId: string,
  now: number,
): Promise<Connection[]> {
  return drizzle(database)
    .select({
      id: mcpGrants.id,
      name: mcpClients.name,
      connectedAt: mcpGrants.created_at,
      lastUsedAt: mcpGrants.last_used_at,
    })
    .from(mcpGrants)
    .innerJoin(mcpClients, eq(mcpClients.id, mcpGrants.client_id))
    .where(
      and(
        eq(mcpGrants.owner_user_id, ownerUserId),
        gt(mcpGrants.refresh_expires_at, now),
      ),
    )
    .orderBy(desc(mcpGrants.created_at), mcpGrants.id)
}

/**
 * Ends one of the author's own connections. The row holds both tokens'
 * hashes, so the agent's next request, with either token, is refused.
 * Another author's connection is not touched.
 */
export async function revokeConnection(
  database: D1Database,
  ownerUserId: string,
  id: string,
): Promise<void> {
  await drizzle(database)
    .delete(mcpGrants)
    .where(and(eq(mcpGrants.id, id), eq(mcpGrants.owner_user_id, ownerUserId)))
}
