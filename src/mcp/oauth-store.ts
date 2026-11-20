import { and, eq, isNull, lt, notExists, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  mcpClientRowSchema,
  mcpClients,
  mcpCodes,
  mcpGrants,
} from '../db/schema'

/** How long a client nobody has connected through yet is kept. */
export const UNUSED_CLIENT_SECONDS = 60 * 60
/**
 * How long a client is kept after its last grant was made or refreshed,
 * once no grant is left: an agent keeps its client ID and comes back with
 * it after the author ended or lost the connection.
 */
export const IDLE_CLIENT_SECONDS = 90 * 24 * 60 * 60
/**
 * The most clients nobody has connected through that are kept at once.
 * Anyone may register, so without it the table could be filled.
 */
export const MAX_UNUSED_CLIENTS = 1000

export type McpClient = Readonly<{
  id: string
  name: string
  redirectUris: readonly string[]
}>

const redirectUrisSchema = z.array(z.string()).min(1)

const noGrant = (db: ReturnType<typeof drizzle>) =>
  notExists(
    db
      .select({ id: mcpGrants.id })
      .from(mcpGrants)
      .where(eq(mcpGrants.client_id, mcpClients.id)),
  )
const noCode = (db: ReturnType<typeof drizzle>) =>
  notExists(
    db
      .select({ id: mcpCodes.code_hash })
      .from(mcpCodes)
      .where(eq(mcpCodes.client_id, mcpClients.id)),
  )

/**
 * Saves a client, and says whether it was saved. Anyone may register one,
 * so the same batch first removes the clients nobody connected through
 * within the hour, and those whose last grant is long gone; then the insert
 * itself refuses while too many unused clients are waiting. Both deletes
 * read the index on (used_at, created_at), not the whole table.
 */
export async function insertClient(
  database: D1Database,
  client: McpClient,
  now: number,
): Promise<boolean> {
  const db = drizzle(database)
  await db.batch([
    db
      .delete(mcpClients)
      .where(
        and(
          isNull(mcpClients.used_at),
          lt(mcpClients.created_at, now - UNUSED_CLIENT_SECONDS),
          noCode(db),
        ),
      ),
    db
      .delete(mcpClients)
      .where(
        and(
          lt(mcpClients.used_at, now - IDLE_CLIENT_SECONDS),
          noGrant(db),
          noCode(db),
        ),
      ),
  ])
  // The count is part of the insert, so two registrations at once cannot
  // both take the last place.
  const inserted = await db.run(
    sql`INSERT INTO ${mcpClients} (id, name, redirect_uris, created_at)
      SELECT ${client.id}, ${client.name},
        ${JSON.stringify(client.redirectUris)}, ${now}
      WHERE (SELECT count(*) FROM ${mcpClients}
        WHERE ${mcpClients.used_at} IS NULL) < ${MAX_UNUSED_CLIENTS}`,
  )
  return inserted.meta.changes > 0
}

/** The registered client of this ID, or null. */
export async function readClient(
  database: D1Database,
  id: string,
): Promise<McpClient | null> {
  const row = await drizzle(database)
    .select()
    .from(mcpClients)
    .where(eq(mcpClients.id, id))
    .get()
    .then((result) => mcpClientRowSchema.optional().parse(result))
  return row
    ? {
        id: row.id,
        name: row.name,
        redirectUris: redirectUrisSchema.parse(JSON.parse(row.redirect_uris)),
      }
    : null
}
