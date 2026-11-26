import { and, eq, gt, isNull, lt, lte, ne, notExists, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  mcpClientRowSchema,
  mcpClients,
  mcpCodes,
  mcpGrants,
} from '../db/schema'
import { parseScopes, scopeText, type Scope } from './scope'

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

export type NewCode = Readonly<{
  codeHash: string
  clientId: string
  ownerUserId: string
  redirectUri: string
  codeChallenge: string
  /** What the author was shown and allowed. */
  scopes: readonly Scope[]
  expiresAt: number
}>

/** Saves the hash of a code the author just allowed. */
export async function insertCode(
  database: D1Database,
  code: NewCode,
): Promise<void> {
  await drizzle(database)
    .insert(mcpCodes)
    .values({
      code_hash: code.codeHash,
      client_id: code.clientId,
      owner_user_id: code.ownerUserId,
      redirect_uri: code.redirectUri,
      code_challenge: code.codeChallenge,
      scope: scopeText(code.scopes),
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
        scopes: parseScopes(row.scope),
      }
    : null
}

/** Notes that a grant was made or refreshed through the client now. */
const usedNow = (
  db: ReturnType<typeof drizzle>,
  clientId: string,
  now: number,
) =>
  db.update(mcpClients).set({ used_at: now }).where(eq(mcpClients.id, clientId))

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
  grant: Readonly<{
    id: string
    clientId: string
    ownerUserId: string
    scopes: readonly Scope[]
  }>,
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
      scope: scopeText(grant.scopes),
      created_at: now,
    }),
    usedNow(db, grant.clientId, now),
  ])
}

/**
 * Replaces the tokens of the grant a refresh token names, in one
 * conditional update that succeeds only for the grant's current token.
 * Null when it does not, and the scopes the grant keeps when it does (a
 * refresh never widens them). If it does not and the grant is there, the token is one that
 * was replaced before, at any time, or was never its token, so the grant is
 * ended. A replaced token coming back means it was copied, and whoever
 * holds the newest one may be the copier (OAuth 2.1, 4.3.1).
 */
export async function rotateGrant(
  database: D1Database,
  grant: Readonly<{ id: string; clientId: string; refreshTokenHash: string }>,
  tokens: TokenHashes,
  now: number,
): Promise<Readonly<{ scopes: readonly Scope[] }> | null> {
  const db = drizzle(database)
  const ofGrant = and(
    eq(mcpGrants.id, grant.id),
    eq(mcpGrants.client_id, grant.clientId),
  )
  const [rotated] = await db.batch([
    db
      .update(mcpGrants)
      .set({
        access_token_hash: tokens.accessTokenHash,
        access_expires_at: tokens.accessExpiresAt,
        refresh_token_hash: tokens.refreshTokenHash,
        refresh_expires_at: tokens.refreshExpiresAt,
      })
      .where(
        and(
          ofGrant,
          eq(mcpGrants.refresh_token_hash, grant.refreshTokenHash),
          gt(mcpGrants.refresh_expires_at, now),
        ),
      )
      .returning({ scope: mcpGrants.scope }),
    // After the update a current token no longer matches its old hash, so
    // this spares the grant just rotated only by naming the new hash.
    db
      .delete(mcpGrants)
      .where(
        and(
          ofGrant,
          ne(mcpGrants.refresh_token_hash, grant.refreshTokenHash),
          ne(mcpGrants.refresh_token_hash, tokens.refreshTokenHash),
        ),
      ),
    usedNow(db, grant.clientId, now),
  ])
  const [row] = rotated
  return row ? { scopes: parseScopes(row.scope) } : null
}
