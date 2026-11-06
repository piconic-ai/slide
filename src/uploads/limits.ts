import { z } from 'zod'

const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const limitsSchema = z
  .strictObject({
    deploymentBytes: positiveInteger.default(10 * 1024 * 1024),
    fileBytes: positiveInteger.default(5 * 1024 * 1024),
    files: positiveInteger.default(100),
    authorBytes: positiveInteger.default(50 * 1024 * 1024),
    startsPerDay: positiveInteger.default(5),
    activeSessions: positiveInteger.default(1),
    sessionSeconds: positiveInteger.default(24 * 60 * 60),
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
