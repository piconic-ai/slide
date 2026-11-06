import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  decks,
  repositoryBindingRowSchema,
  repositoryBindings,
} from '../db/schema'
import type { BindingRequest } from './binding'
import { storedRefsSchema } from './binding'

export type VerifiedRepository = Readonly<{
  repositoryId: string
  repositoryOwnerId: string
  fullName: string
}>

/**
 * Creates the deck if needed and replaces its repository binding, but only
 * when the deck belongs to this owner. Returns false for another's deck.
 */
export async function saveBinding(
  database: D1Database,
  input: Readonly<{
    ownerUserId: string
    request: BindingRequest
    repository: VerifiedRepository
    now: number
  }>,
): Promise<boolean> {
  const db = drizzle(database)
  const { ownerUserId, request, repository, now } = input
  const refs = JSON.stringify(request.branches)
  const [, upsert] = await db.batch([
    db
      .insert(decks)
      .values({ id: request.deck, owner_user_id: ownerUserId, created_at: now })
      .onConflictDoNothing(),
    db
      .insert(repositoryBindings)
      .select(
        db
          .select({
            deck_id: sql<string>`${request.deck}`.as('deck_id'),
            repository_id: sql<string>`${repository.repositoryId}`.as(
              'repository_id',
            ),
            repository_owner_id:
              sql<string>`${repository.repositoryOwnerId}`.as(
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
      }),
  ])
  return upsert.meta.changes > 0
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
