import { z } from 'zod'
import { deploymentRowSchema } from '../db/schema'

/**
 * Each sweep makes a few D1 and R2 calls, so a batch stays well inside the
 * per-invocation subrequest limit.
 */
export const SWEEP_BATCH = 10

// Provisional delay before a failed sweep is retried.
const SWEEP_RETRY_SECONDS = 6 * 60 * 60
// A write can finish at any time after it passed its lease check, so swept
// deployments are visited again on this provisional cadence. Any late object
// is therefore collected eventually instead of being trusted never to land.
const RESWEEP_SECONDS = 7 * 24 * 60 * 60

/** What a stored deployment row must be for a sweep to visit it. */
export const sweepTargetSchema = deploymentRowSchema
  .pick({ id: true, state: true })
  .extend({ state: z.enum(['ready', 'failed', 'expired']) })

export type CleanupSummary = Readonly<{
  expired: number
  swept: number
  failed: number
  deletedObjects: number
}>

/** The instants a cleanup run at `now` compares deployments against. */
export function sweepSchedule(now: number, orphanGraceSeconds: number) {
  return {
    /** Deployments closed before this have passed their grace period. */
    settledBefore: now - orphanGraceSeconds,
    /** Deployments swept before this are visited again. */
    resweepBefore: now - RESWEEP_SECONDS,
    /** When a sweep that failed now is tried again. */
    retryAt: now + SWEEP_RETRY_SECONDS,
  }
}

/** The part of an error that may be logged: no message beyond 200 chars. */
export function describeCleanupError(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message.slice(0, 200) }
    : { name: 'unknown' }
}
