import { z } from 'zod'

/** How long a login code works. */
export const CODE_SECONDS = 10 * 60
/** Wrong codes a single code takes before it is void. */
export const CODE_ATTEMPTS = 5
export const CODE_LENGTH = 6

const positive = z.number().int().positive().max(1_000_000)
/**
 * The total cap: a whole number of codes, where 0 (and a missing value) means
 * the cap is off. It is read as `null` for "off", so that nothing downstream
 * can mistake a 0 for a limit of none being allowed.
 */
const optionalCap = z
  .number()
  .int()
  .min(0)
  .max(1_000_000)
  .default(0)
  .transform((cap) => (cap === 0 ? null : cap))
const limitsSchema = z
  .strictObject({
    /** Codes asked for one address within the window. */
    perAddress: positive.default(5),
    /** Codes asked from one client (an IPv6 /64 counts as one) within it. */
    perSource: positive.default(20),
    /** Tries at entering a code for one address within the window, right or wrong. */
    attemptsPerAddress: positive.default(10),
    /**
     * Codes asked for by everyone together within the window (D-127): the
     * service's cap on login mail, on top of the two above. Off unless a whole
     * number of 1 or more is set (2026-11-26, F42-AC25, F42-AC29): login is
     * made easy, and mail is capped per address and per client only.
     */
    total: optionalCap,
    windowSeconds: positive.default(60 * 60),
  })
  .readonly()

/** The limits on asking for login codes; `LOGIN_CODE_LIMITS` changes them. */
export type LoginCodeLimits = z.infer<typeof limitsSchema>

/**
 * Defaults for a missing or mistaken setting: a mistake must not open the door.
 * A mistaken value anywhere, the total included (negative, fractional, not a
 * number), drops the whole setting, so the per-address and per-client limits
 * return to their defaults and the total is off, as it is without a setting. A
 * mistake never makes a limit looser than leaving the setting out would.
 */
export function parseLoginCodeLimits(input: unknown): LoginCodeLimits {
  const parsed = limitsSchema.safeParse(input ?? {})
  return parsed.success ? parsed.data : limitsSchema.parse({})
}

/**
 * The share of the total cap at which the operator is told at once (F42-AC27):
 * 80%. The number of codes at which that is, rounded up, so a total of 100 is
 * told at the 80th and one of 7 at the 6th. `null` when the cap is off: there
 * is nothing to be near.
 */
export const mailFloodWarnAt = (limits: LoginCodeLimits): number | null =>
  // Whole numbers throughout: 80% as a float (15 * 0.8) is not always exact.
  limits.total === null ? null : Math.ceil((limits.total * 4) / 5)

export type SendDecision =
  | Readonly<{ kind: 'allowed' }>
  | Readonly<{
      kind: 'limited'
      scope: 'address' | 'source' | 'total'
      /** When the earliest request in the window leaves it, in epoch seconds. */
      retryAt: number
    }>

const retryAtOf = (times: readonly number[], limit: number, window: number) => {
  // The newest `limit` requests fill the window; the oldest of them leaves first.
  const sorted = [...times].sort((a, b) => b - a)
  return (sorted[limit - 1] ?? 0) + window
}

/**
 * Whether one more code may be sent, given when this address and this client
 * asked before, and when anyone did (the newest `limits.total` times are
 * enough; ignored when the total cap is off). Requests older than the window
 * no longer count.
 */
export function decideSend(
  limits: LoginCodeLimits,
  now: number,
  asked: Readonly<{
    address: readonly number[]
    source: readonly number[]
    total: readonly number[]
  }>,
): SendDecision {
  const live = (times: readonly number[]) =>
    times.filter((at) => at > now - limits.windowSeconds)
  const address = live(asked.address)
  if (address.length >= limits.perAddress)
    return {
      kind: 'limited',
      scope: 'address',
      retryAt: retryAtOf(address, limits.perAddress, limits.windowSeconds),
    }
  const source = live(asked.source)
  if (source.length >= limits.perSource)
    return {
      kind: 'limited',
      scope: 'source',
      retryAt: retryAtOf(source, limits.perSource, limits.windowSeconds),
    }
  if (limits.total === null) return { kind: 'allowed' }
  const total = live(asked.total)
  if (total.length >= limits.total)
    return {
      kind: 'limited',
      scope: 'total',
      retryAt: retryAtOf(total, limits.total, limits.windowSeconds),
    }
  return { kind: 'allowed' }
}
