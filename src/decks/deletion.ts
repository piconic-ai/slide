import { and, asc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  contentSessions,
  decks,
  deployments,
  previewLaunches,
  purgedPrefixes,
  repositoryBindings,
  uploadFiles,
} from '../db/schema'
import { START_WINDOW_SECONDS, type UploadLimits } from '../uploads/limits'

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

// Each deployment or prefix takes one R2 list, a few R2 deletes, and one D1
// batch, so a run stays well inside the per-invocation subrequest limit.
const PURGE_BATCH = 10
// A write can finish at any time after it passed its lease check, so a
// purged prefix is listed again on this provisional cadence, and forgotten
// once no realistic write can still land.
const PREFIX_RESWEEP_SECONDS = 7 * 24 * 60 * 60
const PREFIX_KEEP_SECONDS = 30 * 24 * 60 * 60

/**
 * How long a deleted deck is kept before its rows are purged. The rows still
 * count toward the owner's start and refusal windows, so they stay until the
 * window has passed; the orphan grace lets a receive that passed its checks
 * before the deletion finish writing.
 */
export function purgeDelaySeconds(limits: UploadLimits): number {
  return Math.max(limits.orphanGraceSeconds, START_WINDOW_SECONDS)
}

export type PurgeSummary = Readonly<{
  deployments: number
  decks: number
  resweptPrefixes: number
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

async function purgeDeployment(env: Env, deploymentId: string, now: number) {
  const deleted = await deleteObjects(env.UPLOADS, `${deploymentId}/`)
  const db = drizzle(env.DB)
  // Rows go only after the objects, so a failed delete is found again. The
  // prefix is remembered in the same transaction as the rows go.
  await db.batch([
    db
      .insert(purgedPrefixes)
      .values({
        deployment_id: deploymentId,
        purged_at: now,
        sweep_after: now + PREFIX_RESWEEP_SECONDS,
      })
      .onConflictDoNothing(),
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

async function resweepPrefix(
  env: Env,
  prefix: Readonly<{ deployment_id: string; purged_at: number }>,
  now: number,
) {
  const deleted = await deleteObjects(env.UPLOADS, `${prefix.deployment_id}/`)
  const db = drizzle(env.DB)
  const where = eq(purgedPrefixes.deployment_id, prefix.deployment_id)
  await (now - prefix.purged_at >= PREFIX_KEEP_SECONDS
    ? db.delete(purgedPrefixes).where(where).run()
    : db
        .update(purgedPrefixes)
        .set({ sweep_after: now + PREFIX_RESWEEP_SECONDS })
        .where(where)
        .run())
  return deleted
}

function logFailure(deploymentId: string, error: unknown) {
  console.error(
    JSON.stringify({
      event: 'deck_purge_failed',
      deploymentId,
      name: error instanceof Error ? error.name : 'unknown',
    }),
  )
}

/** Runs each task, counting failures instead of stopping the batch. */
async function runEach<T>(
  items: readonly T[],
  id: (item: T) => string,
  task: (item: T) => Promise<number>,
) {
  let done = 0
  let deleted = 0
  let failed = 0
  for (const item of items) {
    try {
      deleted += await task(item)
      done++
    } catch (error) {
      failed++
      logFailure(id(item), error)
    }
  }
  return { done, deleted, failed }
}

/**
 * Removes the objects and rows of decks deleted at least `delaySeconds` ago
 * (see `purgeDelaySeconds`), a bounded number of deployments per run, and
 * lists purged prefixes again for objects written late. A deck row goes
 * last, once none of its deployments remain; any failure is retried by the
 * next run.
 */
export async function purgeDeletedDecks(
  env: Env,
  now: number,
  delaySeconds: number,
): Promise<PurgeSummary> {
  const db = drizzle(env.DB)
  const settled = and(
    isNotNull(decks.deleted_at),
    lte(decks.deleted_at, now - delaySeconds),
  )
  const targets = await db
    .select({ id: deployments.id })
    .from(deployments)
    .innerJoin(decks, eq(decks.id, deployments.deck_id))
    .where(settled)
    .orderBy(asc(decks.deleted_at), asc(deployments.id))
    .limit(PURGE_BATCH)
    .all()
  const purged = await runEach(
    targets,
    ({ id }) => id,
    ({ id }) => purgeDeployment(env, id, now),
  )
  const prefixes = await db
    .select({
      deployment_id: purgedPrefixes.deployment_id,
      purged_at: purgedPrefixes.purged_at,
    })
    .from(purgedPrefixes)
    .where(lte(purgedPrefixes.sweep_after, now))
    .orderBy(asc(purgedPrefixes.sweep_after))
    .limit(PURGE_BATCH)
    .all()
  const reswept = await runEach(
    prefixes,
    (prefix) => prefix.deployment_id,
    (prefix) => resweepPrefix(env, prefix, now),
  )
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
    deployments: purged.done,
    decks: removed[1].meta.changes,
    resweptPrefixes: reswept.done,
    deletedObjects: purged.deleted + reswept.deleted,
    failed: purged.failed + reswept.failed,
  }
}
