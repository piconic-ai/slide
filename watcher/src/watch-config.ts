import { z } from 'zod'

/** The addresses that are watched, by the name each is told under. */
export const TARGET_NAMES = ['top', 'viewer', 'content'] as const
export type TargetName = (typeof TARGET_NAMES)[number]

function isPlainHttps(value: string) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' && !url.username && !url.password && !url.port
    )
  } catch {
    return false
  }
}

const address = z.string().refine(isPlainHttps)

const targetsSchema = z.strictObject({
  top: address,
  viewer: address,
  content: address,
})

const rulesSchema = z
  .strictObject({
    failuresToTell: z.number().int().min(1).max(100).default(2),
    throttleSeconds: z
      .number()
      .int()
      .min(60)
      .max(7 * 86400)
      .default(3600),
    timeoutMs: z.number().int().min(500).max(25_000).default(5000),
  })
  .readonly()

export type WatchSettings = z.infer<typeof rulesSchema>

/** The thresholds (F39-AC16). A mistaken setting gives the defaults, whole. */
export function parseSettings(input: unknown): WatchSettings {
  const parsed = rulesSchema.safeParse(input ?? {})
  return parsed.success ? parsed.data : rulesSchema.parse({})
}

export type Targets = Readonly<Record<TargetName, string>>

/**
 * The addresses to check, or null when the setting is missing or one is not
 * an https address on a plain host: nothing is checked then, which the run
 * logs, rather than a half-read list being watched.
 */
export function parseTargets(input: unknown): Targets | null {
  const parsed = targetsSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}
