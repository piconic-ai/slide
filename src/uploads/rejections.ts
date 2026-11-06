import type { UploadInventory } from './inventory'
import type { UploadLimits } from './limits'

/** Reasons recorded on a failed deployment when a start is refused. */
export const startRejections = [
  'too_many_files',
  'file_too_large',
  'deployment_too_large',
  'author_bytes_exceeded',
  'daily_starts_exceeded',
] as const
export type StartRejection = (typeof startRejections)[number]

export type QuotaUsage = Readonly<{
  reservedBytes: number
  activeSessions: number
  startsInWindow: number
}>

/**
 * The outcome of checking quota usage read after a refused conditional
 * insert. `busy` is transient and is not recorded; `race` means the usage no
 * longer explains the refusal, so the caller may retry.
 */
export type QuotaDecision =
  | { readonly kind: 'rejected'; readonly reason: StartRejection }
  | { readonly kind: 'busy' }
  | { readonly kind: 'race' }

export function inventoryRejection(
  inventory: UploadInventory,
  limits: UploadLimits,
): StartRejection | null {
  if (inventory.files.length > limits.files) return 'too_many_files'
  if (inventory.files.some((file) => file.size > limits.fileBytes))
    return 'file_too_large'
  if (inventory.totalBytes > limits.deploymentBytes)
    return 'deployment_too_large'
  return null
}

export function quotaDecision(
  usage: QuotaUsage,
  requestedBytes: number,
  limits: UploadLimits,
): QuotaDecision {
  if (usage.startsInWindow >= limits.startsPerDay)
    return { kind: 'rejected', reason: 'daily_starts_exceeded' }
  if (usage.reservedBytes + requestedBytes > limits.authorBytes)
    return { kind: 'rejected', reason: 'author_bytes_exceeded' }
  if (usage.activeSessions >= limits.activeSessions) return { kind: 'busy' }
  return { kind: 'race' }
}

type RejectionResponse = Readonly<{ status: 409 | 413; message: string }>

const responses: Readonly<Record<StartRejection, RejectionResponse>> = {
  too_many_files: {
    status: 413,
    message: 'Upload inventory has too many files',
  },
  file_too_large: {
    status: 413,
    message: 'An upload file exceeds the file byte limit',
  },
  deployment_too_large: {
    status: 413,
    message: 'Upload inventory exceeds the deployment byte limit',
  },
  author_bytes_exceeded: {
    status: 409,
    message: 'Stored and reserved bytes would exceed the limit',
  },
  daily_starts_exceeded: {
    status: 409,
    message: 'Upload start limit for the last 24 hours reached',
  },
}

/**
 * Inventory limits are 413 and quotas are 409. Neither succeeds by retrying
 * the same attempt; 429 is reserved for transient conflicts.
 */
export function startRejectionResponse(
  reason: StartRejection,
): RejectionResponse {
  return responses[reason]
}
