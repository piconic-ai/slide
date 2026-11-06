import { and, asc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  contentSessions,
  decks,
  deployments,
  previewLaunches,
  repositoryBindings,
  uploadFiles,
} from '../db/schema'

export type DeletionResult = 'deleted' | 'not_found'

/**
 * Marks the owner's deck deleted and, in the same transaction, stops
 * everything that could still read or change it: delivery, owner-only
 * viewing, uploads, and publication. Its objects and rows are removed later
 * by `purgeDeletedDecks`. Repeating the call for a deleted deck succeeds.
 */
export async function markDeckDeleted(
  database: D1Database,
  input: Readonly<{ deckId: string; ownerUserId: string; now: number }>,
): Promise<DeletionResult> {
  const { deckId, ownerUserId, now } = input
  const db = drizzle(database)
  // The steps after the mark run only for the owner's deleted deck, so a
  // foreign or unknown deck changes nothing.
  const deleted = sql`EXISTS (SELECT 1 FROM ${decks}
    WHERE ${decks.id} = ${deckId} AND ${decks.owner_user_id} = ${ownerUserId}
      AND ${decks.deleted_at} IS NOT NULL)`
  const deckDeployments = db
    .select({ id: deployments.id })
    .from(deployments)
    .where(eq(deployments.deck_id, deckId))
  await db.batch([
    db
      .update(decks)
      .set({
        deleted_at: now,
        public_deployment_id: null,
        resume_deployment_id: null,
        paused_at: null,
        // A publication change decided before the deletion no longer lands.
        revision: sql`${decks.revision} + 1`,
        change_id: crypto.randomUUID(),
      })
      .where(
        and(
          eq(decks.id, deckId),
          eq(decks.owner_user_id, ownerUserId),
          sql`${decks.deleted_at} IS NULL`,
        ),
      ),
    // Without a binding, starts, receives, and finalizes are refused.
    db
      .delete(repositoryBindings)
      .where(and(eq(repositoryBindings.deck_id, deckId), deleted)),
    db
      .delete(contentSessions)
      .where(
        and(inArray(contentSessions.deployment_id, deckDeployments), deleted),
      ),
    db
      .delete(previewLaunches)
      .where(
        and(inArray(previewLaunches.deployment_id, deckDeployments), deleted),
      ),
    db
      .update(deployments)
      .set({ state: 'expired', lease_id: null, lease_until: null })
      .where(
        and(
          eq(deployments.deck_id, deckId),
          eq(deployments.state, 'uploading'),
          deleted,
        ),
      ),
  ])
  const row = await db
    .select({ id: decks.id })
    .from(decks)
    .where(
      and(
        eq(decks.id, deckId),
        eq(decks.owner_user_id, ownerUserId),
        isNotNull(decks.deleted_at),
      ),
    )
    .get()
  return row ? 'deleted' : 'not_found'
}

// Each deployment takes one R2 list, a few R2 deletes, and one D1 batch, so
// a run stays well inside the per-invocation subrequest limit.
const PURGE_BATCH = 10

export type PurgeSummary = Readonly<{
  deployments: number
  decks: number
  deletedObjects: number
  failed: number
}>

async function deleteObjects(bucket: R2Bucket, prefix: string) {
  let deleted = 0
  // Deleting shrinks the listing, so each round lists from the start.
  for (;;) {
    const page = await bucket.list({ prefix })
    if (!page.objects.length) return deleted
    await bucket.delete(page.objects.map(({ key }) => key))
    deleted += page.objects.length
  }
}

async function purgeDeployment(env: Env, deploymentId: string) {
  const deleted = await deleteObjects(env.UPLOADS, `${deploymentId}/`)
  const db = drizzle(env.DB)
  // Rows go only after the objects, so a failed delete is found again.
  await db.batch([
    db
      .delete(contentSessions)
      .where(eq(contentSessions.deployment_id, deploymentId)),
    db
      .delete(previewLaunches)
      .where(eq(previewLaunches.deployment_id, deploymentId)),
    db.delete(uploadFiles).where(eq(uploadFiles.deployment_id, deploymentId)),
    db.delete(deployments).where(eq(deployments.id, deploymentId)),
  ])
  return deleted
}

/**
 * Removes the objects and rows of decks deleted at least `graceSeconds` ago,
 * a bounded number of deployments per run. The grace lets a receive that
 * passed its checks before the deletion finish writing, so its object is
 * removed too. A deck row goes last, once none of its deployments remain;
 * any failure is retried by the next run.
 */
export async function purgeDeletedDecks(
  env: Env,
  now: number,
  graceSeconds: number,
): Promise<PurgeSummary> {
  const db = drizzle(env.DB)
  const settled = and(
    isNotNull(decks.deleted_at),
    lte(decks.deleted_at, now - graceSeconds),
  )
  const targets = await db
    .select({ id: deployments.id })
    .from(deployments)
    .innerJoin(decks, eq(decks.id, deployments.deck_id))
    .where(settled)
    .orderBy(asc(decks.deleted_at), asc(deployments.id))
    .limit(PURGE_BATCH)
    .all()
  let purged = 0
  let deletedObjects = 0
  let failed = 0
  for (const { id } of targets) {
    try {
      deletedObjects += await purgeDeployment(env, id)
      purged++
    } catch (error) {
      // One deployment's failure must not stop the rest of the batch.
      failed++
      console.error(
        JSON.stringify({
          event: 'deck_purge_failed',
          deploymentId: id,
          name: error instanceof Error ? error.name : 'unknown',
        }),
      )
    }
  }
  const empty = sql`NOT EXISTS (SELECT 1 FROM ${deployments}
    WHERE ${deployments.deck_id} = ${decks.id})`
  const removed = await db.batch([
    db
      .delete(repositoryBindings)
      .where(
        inArray(
          repositoryBindings.deck_id,
          db.select({ id: decks.id }).from(decks).where(and(settled, empty)),
        ),
      ),
    db.delete(decks).where(and(settled, empty)),
  ])
  return {
    deployments: purged,
    decks: removed[1].meta.changes,
    deletedObjects,
    failed,
  }
}
