import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import {
  contentSessions,
  decks,
  deployments,
  previewLaunches,
} from '../db/schema'
import { notifyCited, notifyFolloweePublished } from '../notifications/store'
import {
  parseDeckPublication,
  publicationColumns,
  type DeckPublication,
} from './state'
import { notHidden } from './takedown-store'
import type { Revocation, Transition } from './transitions'

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

/**
 * Reads a deck's publication for its owner; null for unknown, foreign, or
 * deleted decks.
 */
export async function readPublication(
  database: D1Database,
  deckId: string,
  ownerUserId: string,
): Promise<DeckPublication | null> {
  const row = await drizzle(database)
    .select(publicationFields)
    .from(decks)
    .where(
      and(
        eq(decks.id, deckId),
        eq(decks.owner_user_id, ownerUserId),
        isNull(decks.deleted_at),
      ),
    )
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

/** The actor a transition is saved for. */
export type TransitionActor =
  | Readonly<{ kind: 'author'; ownerUserId: string }>
  | Readonly<{ kind: 'ci' }>

/**
 * Stores a transition decided from `from`, only if the deck is still at that
 * revision, is not deleted, is not hidden by an operator, still belongs to
 * the author who acts (when an author acts), and a deployment it makes public
 * is a ready deployment of the deck. Returns false otherwise, so the caller
 * rereads.
 */
export async function saveTransition(
  database: D1Database,
  input: Readonly<{
    deckId: string
    /** Who acts: an author changes only a deck they own; CI acts for the deck itself. */
    by: TransitionActor
    from: DeckPublication
    transition: Transition
    now: number
  }>,
): Promise<boolean> {
  const { deckId, by, from, transition, now } = input
  const { next } = transition
  const db = drizzle(database)
  const changeId = crypto.randomUUID()
  const publishing = next.publication.kind === 'public'
  const update = db
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
      change_id: changeId,
      first_published_at: publishing
        ? sql`COALESCE(${decks.first_published_at}, ${now})`
        : undefined,
    })
    .where(
      and(
        eq(decks.id, deckId),
        eq(decks.revision, from.revision),
        isNull(decks.deleted_at),
        notHidden,
        by.kind === 'author'
          ? eq(decks.owner_user_id, by.ownerUserId)
          : undefined,
        ...pointerConditions(deckId, next),
      ),
    )
  // Revocation runs in the same transaction and only if this update was
  // stored: it writes a fresh change ID that only it can match.
  const landed = sql`EXISTS (SELECT 1 FROM ${decks}
    WHERE ${decks.id} = ${deckId} AND ${decks.change_id} = ${changeId})`
  const [previous, result] = await db.batch([
    db
      .select({ firstPublishedAt: decks.first_published_at })
      .from(decks)
      .where(eq(decks.id, deckId)),
    update,
    ...revocations(db, deckId, transition.revoke, landed),
  ])
  const saved = result.meta.changes > 0
  if (saved && publishing) {
    await recordPublicationNotification(notifyCited, database, { deckId, now })
    if (previous[0]?.firstPublishedAt === null)
      await recordPublicationNotification(notifyFolloweePublished, database, {
        deckId,
        now,
      })
  }
  return saved
}

async function recordPublicationNotification(
  deliver: typeof notifyCited,
  database: D1Database,
  input: Readonly<{ deckId: string; now: number }>,
) {
  try {
    await deliver(database, input)
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'notifications_unrecorded',
        deckId: input.deckId,
        name: error instanceof Error ? error.name : 'unknown',
      }),
    )
  }
}

function revocations(
  db: DrizzleD1Database,
  deckId: string,
  revoke: Revocation,
  landed: SQL,
) {
  if (revoke.kind === 'none') return []
  const target =
    revoke.kind === 'deployment'
      ? (column: SQLiteColumn) => eq(column, revoke.deploymentId)
      : (column: SQLiteColumn) =>
          inArray(
            column,
            db
              .select({ id: deployments.id })
              .from(deployments)
              .where(eq(deployments.deck_id, deckId)),
          )
  return [
    db
      .delete(contentSessions)
      .where(and(target(contentSessions.deployment_id), landed)),
    // A launch issued before the change cannot open a session after it.
    db
      .delete(previewLaunches)
      .where(and(target(previewLaunches.deployment_id), landed)),
  ] as const
}

/** The commit of a deployment the deck points to, for the deck page. */
export type PointedVersion = Readonly<{
  deploymentId: string
  commit: string
  createdAt: number
}>

export async function readPointedVersion(
  database: D1Database,
  deckId: string,
  deploymentId: string,
): Promise<PointedVersion | null> {
  const row = await drizzle(database)
    .select({
      deploymentId: deployments.id,
      commit: deployments.source_sha,
      createdAt: deployments.created_at,
    })
    .from(deployments)
    .where(
      and(eq(deployments.id, deploymentId), eq(deployments.deck_id, deckId)),
    )
    .get()
  return row ?? null
}
