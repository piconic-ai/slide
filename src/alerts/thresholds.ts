import { z } from 'zod'

/**
 * How long the failures that are counted are kept (seconds): a day. The window
 * they are counted in may not be longer, or a window would count only what was
 * kept, and alert on too few.
 */
export const SIGNAL_KEEP_SECONDS = 24 * 60 * 60

const positive = (max: number) => z.number().int().positive().max(max)

const thresholdsSchema = z
  .strictObject({
    /** Failures to send login mail within the window that raise an alert (D-56). */
    loginMailFailures: positive(1_000_000).default(3),
    /** The window those failures are counted in, in seconds. */
    loginMailWindowSeconds: positive(SIGNAL_KEEP_SECONDS).default(60 * 60),
    /** The size of D1 above which it is told the next day (D-56, D-61). */
    d1SizeBytes: positive(10 ** 13).default(5 * 10 ** 9),
    /**
     * New sign-ups in the last hour more than this many times the hourly
     * average of the 7 days before raise an alert (D-128, F42-AC10).
     */
    signupSurgeFactor: positive(1_000_000).default(10),
    /** And at least this many in that hour, so a quiet week does not make 2 people a surge. */
    signupSurgeMinimum: positive(1_000_000).default(10),
    /** The least gap between two alerts of one kind told at once (D-58). */
    throttleSeconds: positive(7 * 24 * 60 * 60).default(60 * 60),
  })
  .readonly()

/**
 * When an alert is raised and how often it is told (F39-AC16). The numbers
 * are provisional (D-56): `ALERT_THRESHOLDS` changes any of them.
 */
export type AlertThresholds = z.infer<typeof thresholdsSchema>

/**
 * The thresholds of a setting. A missing setting gives the defaults. A
 * mistaken one (an unknown name, a number out of range) also gives the
 * defaults, whole: a half-read setting could silence an alert unseen.
 */
export function parseAlertThresholds(input: unknown): AlertThresholds {
  const parsed = thresholdsSchema.safeParse(input ?? {})
  return parsed.success ? parsed.data : thresholdsSchema.parse({})
}
