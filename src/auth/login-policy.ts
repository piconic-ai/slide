import { z } from 'zod'

/** How long a login code works. */
export const CODE_SECONDS = 10 * 60
/** Wrong codes a single code takes before it is void. */
export const CODE_ATTEMPTS = 5
export const CODE_LENGTH = 6

const positive = z.number().int().positive().max(1_000_000)
const limitsSchema = z
  .strictObject({
    /** Codes asked for one address within the window. */
    perAddress: positive.default(5),
    /** Codes asked from one client (an IPv6 /64 counts as one) within it. */
    perSource: positive.default(20),
    /** Tries at entering a code for one address within the window, right or wrong. */
    attemptsPerAddress: positive.default(10),
    windowSeconds: positive.default(60 * 60),
  })
  .readonly()

/** The limits on asking for login codes; `LOGIN_CODE_LIMITS` changes them. */
export type LoginCodeLimits = z.infer<typeof limitsSchema>

/** Defaults for a missing or mistaken setting: a mistake must not open the door. */
export function parseLoginCodeLimits(input: unknown): LoginCodeLimits {
  const parsed = limitsSchema.safeParse(input ?? {})
  return parsed.success ? parsed.data : limitsSchema.parse({})
}

export type SendDecision =
  | Readonly<{ kind: 'allowed' }>
  | Readonly<{
      kind: 'limited'
      scope: 'address' | 'source'
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
 * asked before. Requests older than the window no longer count.
 */
export function decideSend(
  limits: LoginCodeLimits,
  now: number,
  asked: Readonly<{ address: readonly number[]; source: readonly number[] }>,
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
  return { kind: 'allowed' }
}
