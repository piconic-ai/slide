import { z } from 'zod'

const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const limitsSchema = z
  .strictObject({
    deploymentBytes: positiveInteger.default(10 * 1024 * 1024),
    fileBytes: positiveInteger.default(5 * 1024 * 1024),
    // Finalize checks every object in one request, so the count stays well
    // below the per-invocation limit on calls to R2.
    files: positiveInteger.max(500).default(100),
    // Account quotas below count only the decks the account owns.
    authorBytes: positiveInteger.default(50 * 1024 * 1024),
    decks: positiveInteger.default(20),
    startsPerDay: positiveInteger.default(50),
    activeSessions: positiveInteger.default(1),
    // Bounds how many refused starts are kept for history per 24 hours.
    refusalsPerDay: positiveInteger.default(20),
    sessionSeconds: positiveInteger.default(24 * 60 * 60),
    credentialSeconds: positiveInteger.default(60 * 60),
    // Unreferenced R2 objects younger than this are kept, so a receive that
    // is still writing is not swept. It must exceed the longest lease.
    orphanGraceSeconds: positiveInteger.min(16 * 60).default(60 * 60),
    // Applies to the next received file, including in existing sessions.
    receiveLeaseSeconds: positiveInteger
      .min(30)
      .max(15 * 60)
      .default(120),
  })
  .refine((limits) => limits.fileBytes <= limits.deploymentBytes, {
    message: 'File limit must not exceed deployment limit',
  })
  .refine((limits) => limits.deploymentBytes <= limits.authorBytes, {
    message: 'Deployment limit must not exceed author limit',
  })
  // A receive may still be writing for a moment after its lease check, so
  // the grace period leaves a minute beyond the longest lease.
  .refine(
    (limits) => limits.receiveLeaseSeconds + 60 <= limits.orphanGraceSeconds,
    { message: 'Orphan grace must exceed the receive lease by a minute' },
  )
  .refine((limits) => limits.receiveLeaseSeconds < limits.sessionSeconds, {
    message: 'Receive lease must be shorter than the upload session',
  })
  .readonly()

/** The rolling window counted by `startsPerDay`. */
export const START_WINDOW_SECONDS = 24 * 60 * 60

export type UploadLimits = z.infer<typeof limitsSchema>

export function parseUploadLimits(input: unknown = {}): UploadLimits {
  return limitsSchema.parse(input)
}

export const DEFAULT_UPLOAD_LIMITS = parseUploadLimits()
