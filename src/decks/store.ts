import { and, eq, exists, gt, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  decks,
  repositoryBindingRowSchema,
  repositoryBindings,
} from '../db/schema'
import { authAccount, authSession } from '../db/auth-schema'
import type { BindingRequest } from './binding'
import { storedRefsSchema } from './binding'

export type VerifiedRepository = Readonly<{
  repositoryId: string
  repositoryOwnerId: string
  fullName: string
}>

export type SaveBindingResult =
  | 'saved'
  | 'other_owner'
  | 'deck_limit'
  | 'session_expired'
  /** The owner deleted the deck, and it waits to be purged. */
  | 'deleting'

/**
 * Creates the deck if needed and replaces its repository binding, but only
 * while the original session is valid and the deck belongs to its owner
 * and is not deleted. A new deck is
 * created only while the owner has fewer than `deckLimit` live decks.
 */
export async function saveBinding(
  database: D1Database,
  input: Readonly<{
    ownerUserId: string
    sessionId: string
    request: BindingRequest
    repository: VerifiedRepository
    deckLimit: number
    now: number
  }>,
): Promise<SaveBindingResult> {
  const db = drizzle(database)
  const { ownerUserId, sessionId, request, repository, deckLimit, now } = input
  const liveSession = db
    .select({ id: authSession.id })
    .from(authSession)
    .innerJoin(authAccount, eq(authAccount.userId, authSession.userId))
    .where(
      and(
        eq(authSession.id, sessionId),
        eq(authAccount.providerId, 'github'),
        eq(authAccount.accountId, ownerUserId),
        gt(authSession.expiresAt, sql`unixepoch('subsec') * 1000`),
      ),
    )
  const sessionQuery = liveSession.toSQL()
  const refs = JSON.stringify(request.branches)
  const bind = db
    .insert(repositoryBindings)
    .select(
      db
        .select({
          deck_id: sql<string>`${request.deck}`.as('deck_id'),
          repository_id: sql<string>`${repository.repositoryId}`.as(
            'repository_id',
          ),
          repository_owner_id: sql<string>`${repository.repositoryOwnerId}`.as(
            'repository_owner_id',
          ),
          repository_full_name: sql<string>`${repository.fullName}`.as(
            'repository_full_name',
          ),
          allowed_refs: sql<string>`${refs}`.as('allowed_refs'),
          verified_by: sql<string>`${ownerUserId}`.as('verified_by'),
          verified_at: sql<number>`${now}`.as('verified_at'),
        })
        .from(decks)
        .where(
          and(
            eq(decks.id, request.deck),
            eq(decks.owner_user_id, ownerUserId),
            isNull(decks.deleted_at),
            exists(liveSession),
          ),
        ),
    )
    .onConflictDoUpdate({
      target: repositoryBindings.deck_id,
      set: {
        repository_id: repository.repositoryId,
        repository_owner_id: repository.repositoryOwnerId,
        repository_full_name: repository.fullName,
        allowed_refs: refs,
        verified_by: ownerUserId,
        verified_at: now,
      },
    })
  const { sql: bindSql, params } = bind.toSQL()
  // D1's own batch, because drizzle's cannot run the raw deck insert. The
  // insert lists its columns so the others take their defaults.
  const [, upsert, authorization] = await database.batch<{
    session_valid: number
  }>([
    database
      .prepare(
        `INSERT INTO decks (id, owner_user_id, created_at)
         SELECT ?, ?, ?
         WHERE EXISTS (${sessionQuery.sql})
           AND (SELECT COUNT(*) FROM decks
           WHERE owner_user_id = ? AND deleted_at IS NULL) < ?
         ON CONFLICT DO NOTHING`,
      )
      .bind(
        request.deck,
        ownerUserId,
        now,
        ...sessionQuery.params,
        ownerUserId,
        deckLimit,
      ),
    database.prepare(bindSql).bind(...params),
    database
      .prepare(`SELECT EXISTS (${sessionQuery.sql}) AS session_valid`)
      .bind(...sessionQuery.params),
  ])
  if (upsert.meta.changes > 0) return 'saved'
  if (authorization.results[0]?.session_valid !== 1) return 'session_expired'
  // Nothing was bound: the deck is another owner's, deleted, or not created.
  const existing = await db
    .select({ owner: decks.owner_user_id, deletedAt: decks.deleted_at })
    .from(decks)
    .where(eq(decks.id, request.deck))
    .get()
  if (!existing) return 'deck_limit'
  return existing.owner === ownerUserId && existing.deletedAt !== null
    ? 'deleting'
    : 'other_owner'
}

const deckSummarySchema = repositoryBindingRowSchema.extend({
  allowed_refs: storedRefsSchema,
})

export async function listBindings(database: D1Database, ownerUserId: string) {
  const rows = await drizzle(database)
    .select({ binding: repositoryBindings })
    .from(repositoryBindings)
    .innerJoin(decks, eq(decks.id, repositoryBindings.deck_id))
    .where(eq(decks.owner_user_id, ownerUserId))
    .orderBy(repositoryBindings.deck_id)
    .all()
  return z
    .array(deckSummarySchema)
    .parse(rows.map(({ binding }) => binding))
    .map((binding) => ({
      deck: binding.deck_id,
      repository: binding.repository_full_name,
      repositoryId: binding.repository_id,
      allowedRefs: binding.allowed_refs,
      verifiedAt: binding.verified_at,
    }))
}

const policyRowSchema = z.object({
  ownerUserId: z.string(),
  repositoryId: z.string(),
  repositoryOwnerId: z.string(),
  allowedRefs: storedRefsSchema,
})

/**
 * The upload policy for a deck: its connected repository and the deck owner
 * as the only allowed actor. Null when the deck has no binding.
 */
export async function readDeckPolicy(database: D1Database, deckId: string) {
  const row = await drizzle(database)
    .select({
      ownerUserId: decks.owner_user_id,
      repositoryId: repositoryBindings.repository_id,
      repositoryOwnerId: repositoryBindings.repository_owner_id,
      allowedRefs: repositoryBindings.allowed_refs,
    })
    .from(repositoryBindings)
    .innerJoin(decks, eq(decks.id, repositoryBindings.deck_id))
    .where(eq(repositoryBindings.deck_id, deckId))
    .get()
  if (!row) return null
  const parsed = policyRowSchema.parse(row)
  return {
    ownerUserId: parsed.ownerUserId,
    repositoryId: parsed.repositoryId,
    repositoryOwnerId: parsed.repositoryOwnerId,
    actorId: parsed.ownerUserId,
    allowedRefs: parsed.allowedRefs,
  }
}
