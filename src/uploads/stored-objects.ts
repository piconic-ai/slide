/** What finalize expects to find in R2 for one received file. */
export type ExpectedObject = Readonly<{ size: number; sha256: string }>

/** The parts of an R2 head result that finalize checks. */
export type StoredObject = Readonly<{ size: number; sha256: string | null }>

export type StoredObjectCheck = 'ok' | 'missing' | 'mismatch'

export function hexDigest(buffer: ArrayBuffer | undefined): string | null {
  if (!buffer) return null
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/**
 * Compares a stored object with its receipt. An object without a stored
 * checksum is a mismatch because finalize cannot prove its content.
 */
export function checkStoredObject(
  expected: ExpectedObject,
  stored: StoredObject | null,
): StoredObjectCheck {
  if (!stored) return 'missing'
  if (stored.size !== expected.size || stored.sha256 !== expected.sha256)
    return 'mismatch'
  return 'ok'
}
