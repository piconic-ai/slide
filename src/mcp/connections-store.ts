import { and, desc, eq, gt, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, deployments, mcpClients, mcpGrants } from '../db/schema'

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
 * The uploads agents began for the author and have not finished are given
 * up too: their credentials are separate from the connection and would go
 * on working for up to an hour. Which connection began an upload is not
 * recorded, so every unfinished upload from an agent ends. Another
 * author's connection is not touched, and nothing ends for an ID that is
 * not the author's connection.
 */
export async function revokeConnection(
  database: D1Database,
  ownerUserId: string,
  id: string,
  now: number,
): Promise<void> {
  const db = drizzle(database)
  const ended = await db
    .delete(mcpGrants)
    .where(and(eq(mcpGrants.id, id), eq(mcpGrants.owner_user_id, ownerUserId)))
    .run()
  if (!ended.meta.changes) return
  await db
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
        eq(deployments.source, 'mcp'),
        inArray(
          deployments.deck_id,
          db
            .select({ id: decks.id })
            .from(decks)
            .where(eq(decks.owner_user_id, ownerUserId)),
        ),
      ),
    )
}
