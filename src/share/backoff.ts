/** The demo's first wait, as in the slide it stands for. */
export const BACKOFF_FIRST_MS = 500

/** The ranges the demo's sliders allow. */
export const BACKOFF_FACTOR = { min: 1, max: 3, step: 0.5, initial: 2 } as const
export const BACKOFF_TRIES = { min: 1, max: 8, step: 1, initial: 5 } as const

export type BackoffStep = Readonly<{
  /** 1 for the first try. */
  attempt: number
  /** How long to wait before this try; the first goes at once. */
  waitMs: number
}>

/**
 * Each try of an exponential backoff and the wait before it: none before
 * the first, then `firstMs`, growing by `factor` each time.
 */
export function backoffSchedule(
  factor: number,
  tries: number,
  firstMs = BACKOFF_FIRST_MS,
): readonly BackoffStep[] {
  // Anything the sliders cannot produce schedules nothing rather than NaN
  // waits or an unbounded list.
  if (![factor, tries, firstMs].every(Number.isFinite)) return []
  const count = Math.min(Math.max(0, Math.floor(tries)), BACKOFF_TRIES.max)
  return Array.from({ length: count }, (_, i) => ({
    attempt: i + 1,
    waitMs: i === 0 ? 0 : firstMs * factor ** (i - 1),
  }))
}

export const totalWaitMs = (steps: readonly BackoffStep[]) =>
  steps.reduce((sum, step) => sum + step.waitMs, 0)

/** Milliseconds as seconds, to at most two decimals: 500 → "0.5s". */
export const seconds = (ms: number) => `${Number((ms / 1000).toFixed(2))}s`
