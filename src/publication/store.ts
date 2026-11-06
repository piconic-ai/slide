import { and, eq, sql, type SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { decks, deployments } from '../db/schema'
import {
  parseDeckPublication,
  publicationColumns,
  type DeckPublication,
} from './state'
import type { Transition } from './transitions'

export const publicationFields = {
  publication_mode: decks.publication_mode,
  paused_at: decks.paused_at,
  public_deployment_id: decks.public_deployment_id,
  resume_deployment_id: decks.resume_deployment_id,
  revision: decks.revision,
  author_revision: decks.author_revision,
  ci_run_id: decks.ci_run_id,
  ci_run_attempt: decks.ci_run_attempt,
}

/** Reads a deck's publication for its owner; null for unknown or foreign. */
export async function readPublication(
  database: D1Database,
  deckId: string,
  ownerUserId: string,
): Promise<DeckPublication | null> {
  const row = await drizzle(database)
    .select(publicationFields)
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.owner_user_id, ownerUserId)))
    .get()
  return row ? parseDeckPublication(row) : null
}

/** A condition that the deployment is ready and belongs to the deck. */
export const readyDeploymentOf = (deckId: string, deploymentId: string) =>
  sql`EXISTS (SELECT 1 FROM ${deployments}
    WHERE ${deployments.id} = ${deploymentId}
      AND ${deployments.deck_id} = ${deckId}
      AND ${deployments.state} = 'ready')`

/** Whether the deployment is a ready deployment of the deck. */
export async function isPublishable(
  database: D1Database,
  deckId: string,
  deploymentId: string,
): Promise<boolean> {
  const row = await drizzle(database)
    .select({ ok: sql<number>`1` })
    .from(sql`(SELECT 1)`)
    .where(readyDeploymentOf(deckId, deploymentId))
    .get()
  return row !== undefined
}

// Only a deployment that becomes public needs checking; a pause or a mode
// change must succeed even if the remembered deployment is no longer ready.
function pointerConditions(deckId: string, next: DeckPublication): SQL[] {
  const { publication } = next
  return publication.kind === 'public'
    ? [readyDeploymentOf(deckId, publication.deploymentId)]
    : []
}

/**
 * Stores a transition decided from `from`, only if the deck is still at that
 * revision, still has the given owner, and a deployment it makes public is a
 * ready deployment of the deck. Returns false otherwise, so the caller
 * rereads.
 */
export async function saveTransition(
  database: D1Database,
  input: Readonly<{
    deckId: string
    /** Required for author operations; CI acts for the deck itself. */
    ownerUserId?: string
    from: DeckPublication
    transition: Transition
    now: number
  }>,
): Promise<boolean> {
  const { deckId, ownerUserId, from, transition, now } = input
  const { next } = transition
  const result = await drizzle(database)
    .update(decks)
    .set({
      publication_mode: next.mode,
      ...publicationColumns(
        next.publication,
        from.publication.kind === 'paused' && next.publication.kind === 'paused'
          ? sql`${decks.paused_at}`
          : now,
      ),
      revision: next.revision,
      author_revision: next.authorRevision,
      ci_run_id: next.lastCiRun?.runId ?? null,
      ci_run_attempt: next.lastCiRun?.attempt ?? null,
    })
    .where(
      and(
        eq(decks.id, deckId),
        eq(decks.revision, from.revision),
        ownerUserId === undefined
          ? undefined
          : eq(decks.owner_user_id, ownerUserId),
        ...pointerConditions(deckId, next),
      ),
    )
    .run()
  return result.meta.changes > 0
}
