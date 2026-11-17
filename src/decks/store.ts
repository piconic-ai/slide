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
import {
  deckIdSchema,
  deckSlugSchema,
  storedRefsSchema,
  type DeckId,
  type DeckSlug,
} from './binding'

export type VerifiedRepository = Readonly<{
  repositoryId: string
  repositoryOwnerId: string
  fullName: string
}>

export type SaveBindingResult =
  | 'saved'
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
  const refs = JSON.stringify(request.branches)
  // The key of a deck that does not exist yet; an existing deck keeps its own.
  const newDeckId = deckIdSchema.parse(crypto.randomUUID())
  const bind = db
    .insert(repositoryBindings)
    .select(
      db
        .select({
          deck_id: sql<string>`${decks.id}`.as('deck_id'),
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
            eq(decks.owner_user_id, ownerUserId),
            eq(decks.slug, request.deck),
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
  const deckCount = db.$count(
    decks,
    and(eq(decks.owner_user_id, ownerUserId), isNull(decks.deleted_at)),
  )
  // Drizzle's insert.select requires every column; this insert preserves omitted schema defaults.
  const createDeck = sql`
    INSERT INTO ${decks} (
      ${sql.identifier(decks.id.name)},
      ${sql.identifier(decks.slug.name)},
      ${sql.identifier(decks.owner_user_id.name)},
      ${sql.identifier(decks.created_at.name)}
    )
    SELECT ${newDeckId}, ${request.deck}, ${ownerUserId}, ${now}
    WHERE ${exists(liveSession)} AND ${deckCount} < ${deckLimit}
    ON CONFLICT DO NOTHING
  `
  // Drizzle 0.45.4's D1 batch cannot bind SQLiteRaw parameters.
  // inlineParams escapes the literals for the parameterless batch path.
  const [, upsert, authorization] = await db.batch([
    db.run(createDeck.inlineParams()),
    bind,
    liveSession,
  ])
  if (upsert.meta.changes > 0) return 'saved'
  if (authorization.length === 0) return 'session_expired'
  // Nothing was bound: the owner's deck is being deleted, or none was created.
  const existing = await db
    .select({ deletedAt: decks.deleted_at })
    .from(decks)
    .where(
      and(eq(decks.owner_user_id, ownerUserId), eq(decks.slug, request.deck)),
    )
    .get()
  return existing?.deletedAt != null ? 'deleting' : 'deck_limit'
}

const deckSummarySchema = repositoryBindingRowSchema.extend({
  allowed_refs: storedRefsSchema,
})

export async function listBindings(database: D1Database, ownerUserId: string) {
  const rows = await drizzle(database)
    .select({ binding: repositoryBindings, slug: decks.slug })
    .from(repositoryBindings)
    .innerJoin(decks, eq(decks.id, repositoryBindings.deck_id))
    .where(eq(decks.owner_user_id, ownerUserId))
    .orderBy(decks.slug)
    .all()
  return rows.map(({ binding: row, slug }) => {
    const binding = deckSummarySchema.parse(row)
    return {
      deck: deckSlugSchema.parse(slug),
      repository: binding.repository_full_name,
      repositoryId: binding.repository_id,
      allowedRefs: binding.allowed_refs,
      verifiedAt: binding.verified_at,
    }
  })
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

/**
 * The key of the owner's deck with this slug, or null. A slug is the
 * author's own name, so another author's deck of the same slug is not found
 * here, and a deck that is not there looks the same as one that is not yours.
 * `deleted` is set while the deck waits to be purged.
 */
export async function resolveDeck(
  database: D1Database,
  ownerUserId: string,
  slug: string,
): Promise<Readonly<{ id: DeckId; slug: DeckSlug; deleted: boolean }> | null> {
  const parsed = deckSlugSchema.safeParse(slug)
  if (!parsed.success) return null
  const row = await drizzle(database)
    .select({ id: decks.id, deletedAt: decks.deleted_at })
    .from(decks)
    .where(
      and(eq(decks.owner_user_id, ownerUserId), eq(decks.slug, parsed.data)),
    )
    .get()
  return row
    ? {
        id: deckIdSchema.parse(row.id),
        slug: parsed.data,
        deleted: row.deletedAt !== null,
      }
    : null
}
