import { z } from 'zod'

const positive = z.number().int().positive().max(1_000_000)
const limitsSchema = z
  .strictObject({
    /** How many days after registering a person counts as new (D-130, F42-AC21). */
    days: positive.default(7),
    /** New slides a new person may put up in one "day" (D-130, provisional). */
    perDay: positive.default(3),
  })
  .readonly()

/** The limits on what a newly registered person may put up; `NEW_AUTHOR_LIMITS` changes them (F42-AC22). */
export type NewAuthorLimits = z.infer<typeof limitsSchema>

/** Defaults for a missing or mistaken setting: a mistake must not lift the limit. */
export function parseNewAuthorLimits(input: unknown): NewAuthorLimits {
  const parsed = limitsSchema.safeParse(input ?? {})
  return parsed.success ? parsed.data : limitsSchema.parse({})
}

const DAY = 24 * 60 * 60

/**
 * Whether the person registered within the last `limits.days` days, so that
 * the limit applies to them (F42-AC21). The day of registering is the time
 * of their account, to the second: at exactly `days` days they are no
 * longer new. Someone with no account (not registered) is not "new".
 */
export function isNewAuthor(
  registeredAt: number | null,
  now: number,
  limits: NewAuthorLimits,
): boolean {
  return registeredAt !== null && now < registeredAt + limits.days * DAY
}

/**
 * What a "day" is, for counting the new slides a new person may put up
 * (F42-AC17, F42-AC18). THIS IS THE ONE THING NOT DECIDED: D-130 says "1 日に
 * 3 本" and does not say whether the day is the last 24 hours or a calendar
 * day (and then in which time zone). Work R stopped here and asked the
 * client (docs/dev/f42-open-signup.md, "決まっていないこと"), so no day is
 * defined and nothing is limited until it is.
 *
 * The rest of the limit is built around this seam: when a window is given,
 * `since` is the start of the day the slide counts in, and `availableAt` is,
 * given the times of the slides already put up since, when the next may be.
 */
export type PlacementWindow = Readonly<{
  since: number
  availableAt: (placedAt: readonly number[]) => number
}>

/** The window of "a day" at `now`; null while the definition is not decided. */
export function placementWindowOf(_now: number): PlacementWindow | null {
  return null
}

export type PlacementDecision =
  | Readonly<{ kind: 'allowed' }>
  | Readonly<{ kind: 'refused'; availableAt: number }>

/**
 * Whether a new slide may be put up now. Not for a person who is no longer
 * new (F42-AC21), and not while no window is defined. `placedAt` is when
 * each of their new slides in the window was made; a new version of a slide
 * is not one of them (F42-AC19), which is the store's reading.
 */
export function decidePlacement(input: {
  now: number
  registeredAt: number | null
  limits: NewAuthorLimits
  window: PlacementWindow | null
  placedAt: readonly number[]
}): PlacementDecision {
  const { now, registeredAt, limits, window, placedAt } = input
  if (!isNewAuthor(registeredAt, now, limits) || window === null)
    return { kind: 'allowed' }
  const inWindow = placedAt.filter((at) => at >= window.since && at <= now)
  return inWindow.length < limits.perDay
    ? { kind: 'allowed' }
    : { kind: 'refused', availableAt: window.availableAt(inWindow) }
}
