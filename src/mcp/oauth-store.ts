import { and, eq, lt, notExists } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  mcpClientRowSchema,
  mcpClients,
  mcpCodes,
  mcpGrants,
} from '../db/schema'

/** How long a client nobody connected through is kept. */
export const UNUSED_CLIENT_SECONDS = 24 * 60 * 60

export type McpClient = Readonly<{
  id: string
  name: string
  redirectUris: readonly string[]
}>

const redirectUrisSchema = z.array(z.string()).min(1)

/**
 * Saves a client. Anyone may register one, so the same batch removes the
 * clients that were registered a day ago or more and never led to a code or
 * a grant.
 */
export async function insertClient(
  database: D1Database,
  client: McpClient,
  now: number,
): Promise<void> {
  const db = drizzle(database)
  await db.batch([
    db
      .delete(mcpClients)
      .where(
        and(
          lt(mcpClients.created_at, now - UNUSED_CLIENT_SECONDS),
          notExists(
            db
              .select({ id: mcpGrants.id })
              .from(mcpGrants)
              .where(eq(mcpGrants.client_id, mcpClients.id)),
          ),
          notExists(
            db
              .select({ id: mcpCodes.code_hash })
              .from(mcpCodes)
              .where(eq(mcpCodes.client_id, mcpClients.id)),
          ),
        ),
      ),
    db.insert(mcpClients).values({
      id: client.id,
      name: client.name,
      redirect_uris: JSON.stringify(client.redirectUris),
      created_at: now,
    }),
  ])
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

export type NewCode = Readonly<{
  codeHash: string
  clientId: string
  ownerUserId: string
  redirectUri: string
  codeChallenge: string
  expiresAt: number
}>

/** Saves the hash of a code the author just allowed. */
export async function insertCode(
  database: D1Database,
  code: NewCode,
): Promise<void> {
  await drizzle(database).insert(mcpCodes).values({
    code_hash: code.codeHash,
    client_id: code.clientId,
    owner_user_id: code.ownerUserId,
    redirect_uri: code.redirectUri,
    code_challenge: code.codeChallenge,
    expires_at: code.expiresAt,
  })
}
