import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { deployments, uploadFiles } from '../db/schema'
import { parseUploadLimits } from './limits'
import {
  SWEEP_BATCH,
  sweepSchedule,
  sweepTargetSchema,
  describeCleanupError,
  type CleanupSummary,
} from './cleanup'
import { planSweep, type ListedObject, type SweepTarget } from './sweep-plan'

async function listObjects(bucket: R2Bucket, prefix: string) {
  const listed: ListedObject[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, cursor })
    for (const object of page.objects)
      listed.push({
        key: object.key,
        uploaded: Math.floor(object.uploaded.getTime() / 1000),
      })
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return listed
}

async function sweepDeployment(
  env: Env,
  target: SweepTarget,
  now: number,
  graceSeconds: number,
) {
  const db = drizzle(env.DB)
  const referenced = await db
    .select({ key: uploadFiles.object_key })
    .from(uploadFiles)
    .where(eq(uploadFiles.deployment_id, target.id))
    .all()
  const plan = planSweep(
    target,
    await listObjects(env.UPLOADS, `${target.id}/`),
    new Set(referenced.flatMap(({ key }) => (key ? [key] : []))),
    now,
    graceSeconds,
  )
  // R2 accepts at most 1000 keys per delete call.
  for (let start = 0; start < plan.delete.length; start += 1000)
    await env.UPLOADS.delete(plan.delete.slice(start, start + 1000))
  // Receipts of a closed deployment are cleared only once all its objects
  // are gone, so D1 keeps pointing at any object kept for its grace period.
  if (!plan.complete) return { deleted: plan.delete.length, complete: false }
  if (target.state !== 'ready')
    await db
      .update(uploadFiles)
      .set({ object_key: null })
      .where(eq(uploadFiles.deployment_id, target.id))
      .run()
  await db
    .update(deployments)
    .set({ swept_at: now })
    .where(eq(deployments.id, target.id))
    .run()
  return { deleted: plan.delete.length, complete: true }
}

/**
 * Closes expired sessions and removes R2 objects that no ready file map
 * references. Every step is safe to repeat: usage is derived from state, and
 * a deployment is marked swept only after its objects are gone.
 */
export async function runUploadCleanup(
  env: Env,
  now: number,
): Promise<CleanupSummary> {
  const limits = parseUploadLimits(env.UPLOAD_LIMITS)
  const db = drizzle(env.DB)
  const expired = await db
    .update(deployments)
    .set({ state: 'expired', lease_id: null, lease_until: null })
    .where(
      and(eq(deployments.state, 'uploading'), lte(deployments.expires_at, now)),
    )
    .run()
  const { settledBefore, resweepBefore, retryAt } = sweepSchedule(
    now,
    limits.orphanGraceSeconds,
  )
  const targets = await db
    .select({ id: deployments.id, state: deployments.state })
    .from(deployments)
    .where(
      and(
        or(isNull(deployments.sweep_after), lte(deployments.sweep_after, now)),
        or(
          and(
            isNull(deployments.swept_at),
            inArray(deployments.state, ['ready', 'failed', 'expired']),
            or(
              lte(deployments.ready_at, settledBefore),
              lte(deployments.expires_at, settledBefore),
            ),
          ),
          // Refused starts never receive files, so only deployments that
          // accepted writes are visited again.
          and(
            lte(deployments.swept_at, resweepBefore),
            inArray(deployments.state, ['ready', 'expired']),
          ),
        ),
      ),
    )
    // Never-swept deployments first, then the longest since their last sweep;
    // a failed sweep is deferred so it cannot block the rest.
    .orderBy(
      sql`${deployments.swept_at} IS NOT NULL`,
      asc(deployments.swept_at),
      asc(deployments.created_at),
    )
    .limit(SWEEP_BATCH)
    .all()
    .then((rows) => sweepTargetSchema.array().parse(rows))
  let deletedObjects = 0
  let swept = 0
  let failed = 0
  for (const target of targets) {
    try {
      const result = await sweepDeployment(
        env,
        target,
        now,
        limits.orphanGraceSeconds,
      )
      deletedObjects += result.deleted
      if (result.complete) swept++
    } catch (error) {
      // One deployment's failure must not stop the rest of the batch.
      failed++
      console.error(
        JSON.stringify({
          event: 'upload_cleanup_failed',
          deploymentId: target.id,
          ...describeCleanupError(error),
        }),
      )
      await db
        .update(deployments)
        .set({ sweep_after: retryAt })
        .where(eq(deployments.id, target.id))
        .run()
    }
  }
  return { expired: expired.meta.changes, swept, failed, deletedObjects }
}
