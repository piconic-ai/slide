import { and, eq, gt, lt, lte, notExists } from 'drizzle-orm'
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

/**
 * Takes a code out for good, whether or not the rest of the exchange then
 * succeeds: one statement deletes and returns it, so two requests with the
 * same code cannot both get it. Null when there is no such code or it has
 * expired.
 */
export async function takeCode(
  database: D1Database,
  codeHash: string,
  now: number,
): Promise<Omit<NewCode, 'codeHash' | 'expiresAt'> | null> {
  const [row] = await drizzle(database)
    .delete(mcpCodes)
    .where(eq(mcpCodes.code_hash, codeHash))
    .returning()
  return row && row.expires_at > now
    ? {
        clientId: row.client_id,
        ownerUserId: row.owner_user_id,
        redirectUri: row.redirect_uri,
        codeChallenge: row.code_challenge,
      }
    : null
}

/** The hashes and expiry times of a pair of tokens just made. */
export type TokenHashes = Readonly<{
  accessTokenHash: string
  accessExpiresAt: number
  refreshTokenHash: string
  refreshExpiresAt: number
}>

/**
 * Saves a grant: one agent an author connected. An earlier grant of the
 * same client and author is replaced, and codes and grants past their time
 * are removed along the way.
 */
export async function insertGrant(
  database: D1Database,
  grant: Readonly<{ id: string; clientId: string; ownerUserId: string }>,
  tokens: TokenHashes,
  now: number,
): Promise<void> {
  const db = drizzle(database)
  await db.batch([
    db.delete(mcpCodes).where(lte(mcpCodes.expires_at, now)),
    db.delete(mcpGrants).where(lte(mcpGrants.refresh_expires_at, now)),
    db
      .delete(mcpGrants)
      .where(
        and(
          eq(mcpGrants.client_id, grant.clientId),
          eq(mcpGrants.owner_user_id, grant.ownerUserId),
        ),
      ),
    db.insert(mcpGrants).values({
      id: grant.id,
      client_id: grant.clientId,
      owner_user_id: grant.ownerUserId,
      access_token_hash: tokens.accessTokenHash,
      access_expires_at: tokens.accessExpiresAt,
      refresh_token_hash: tokens.refreshTokenHash,
      refresh_expires_at: tokens.refreshExpiresAt,
      created_at: now,
    }),
  ])
}

/**
 * Replaces the tokens of the grant whose refresh token this is, in one
 * conditional update. False when no live grant of the client has it; a
 * grant whose refresh token it was one rotation ago is then ended, since
 * the token was used twice: by the client and by whoever copied it.
 */
export async function rotateGrant(
  database: D1Database,
  clientId: string,
  refreshTokenHash: string,
  tokens: TokenHashes,
  now: number,
): Promise<boolean> {
  const db = drizzle(database)
  const rotated = await db
    .update(mcpGrants)
    .set({
      access_token_hash: tokens.accessTokenHash,
      access_expires_at: tokens.accessExpiresAt,
      refresh_token_hash: tokens.refreshTokenHash,
      previous_refresh_token_hash: refreshTokenHash,
      refresh_expires_at: tokens.refreshExpiresAt,
    })
    .where(
      and(
        eq(mcpGrants.client_id, clientId),
        eq(mcpGrants.refresh_token_hash, refreshTokenHash),
        gt(mcpGrants.refresh_expires_at, now),
      ),
    )
    .run()
  if (rotated.meta.changes) return true
  await db
    .delete(mcpGrants)
    .where(
      and(
        eq(mcpGrants.client_id, clientId),
        eq(mcpGrants.previous_refresh_token_hash, refreshTokenHash),
      ),
    )
  return false
}
