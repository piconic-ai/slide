/** How long a handle let go of stays out of reach: 90 days (D-16). */
export const HANDLE_HOLD_SECONDS = 90 * 24 * 60 * 60

/**
 * The latest release time that still holds a handle at `now`: a handle let
 * go of after this moment cannot be taken yet. Exactly 90 days after its
 * release, it can.
 */
export const heldSince = (now: number): number => now - HANDLE_HOLD_SECONDS

/** Whether a handle let go of at `releasedAt` is still held at `now`. */
export const isHeld = (releasedAt: number, now: number): boolean =>
  releasedAt > heldSince(now)
