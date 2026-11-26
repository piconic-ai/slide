import { z } from 'zod'

const positive = (max: number) => z.number().int().positive().max(max)

const thresholdsSchema = z
  .strictObject({
    /** Failures to send login mail within the window that raise an alert (D-56). */
    loginMailFailures: positive(1_000_000).default(3),
    /** The window those failures are counted in, in seconds. */
    loginMailWindowSeconds: positive(7 * 24 * 60 * 60).default(60 * 60),
    /** The size of D1 above which it is told the next day (D-56, D-61). */
    d1SizeBytes: positive(10 ** 13).default(5 * 10 ** 9),
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
