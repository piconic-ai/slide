import { z } from 'zod'

const positive = z.number().int().positive().max(1_000_000)
const limitsSchema = z
  .strictObject({
    /** How many days after registering a person counts as new (D-130, F42-AC21). */
    days: positive.default(7),
    /** New slides a new person may put up in the last 24 hours (D-130; the number is provisional). */
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

/** The length of the window, in seconds: "a day" is the last 24 hours (D-130, 2026-11-26). */
const WINDOW_SECONDS = DAY

/**
 * What "a day" is, for counting the new slides a new person may put up
 * (F42-AC17, F42-AC18): the last 24 hours, `(since, until]`. The client
 * decided this on 2026-11-26 (D-130): it has no cut-off to cross, so 6 slides
 * cannot be put up around midnight, and the definition is this one value.
 * A slide made at exactly `since` has left the window, which is when
 * `availableAt` says the room opens.
 */
export type PlacementWindow = Readonly<{
  since: number
  until: number
  seconds: number
}>

/** The window of "a day" that ends at `now`: the one place it is defined. */
export function placementWindowOf(now: number): PlacementWindow {
  return { since: now - WINDOW_SECONDS, until: now, seconds: WINDOW_SECONDS }
}

/** What holds a new person to the limit: the window, and how many it may hold. */
export type PlacementCap = Readonly<{
  window: PlacementWindow
  perDay: number
}>

/** The cap on someone at `now`, or null when they are not new (F42-AC21). */
export function placementCapOf(
  now: number,
  registeredAt: number | null,
  limits: NewAuthorLimits,
): PlacementCap | null {
  return isNewAuthor(registeredAt, now, limits)
    ? { window: placementWindowOf(now), perDay: limits.perDay }
    : null
}

export type PlacementDecision =
  | Readonly<{ kind: 'allowed' }>
  | Readonly<{ kind: 'refused'; availableAt: number }>

/**
 * Whether a new slide may be put up now, given when each new slide of the
 * person was made (F42-AC17, F42-AC18). `placedAt` is the store's reading:
 * a new version of a slide is not one of them (F42-AC19), a deleted slide
 * is. Times outside the window are not counted.
 *
 * When refused, `availableAt` is when the room opens: the moment the
 * `perDay`-th newest slide in the window leaves it (the oldest one when the
 * window holds exactly `perDay`; a later one when a lowered setting leaves it
 * holding more).
 */
export function decidePlacement(
  cap: PlacementCap | null,
  placedAt: readonly number[],
): PlacementDecision {
  if (cap === null) return { kind: 'allowed' }
  const { window, perDay } = cap
  const inWindow = placedAt
    .filter((at) => at > window.since && at <= window.until)
    .sort((a, b) => b - a)
  const blocking = inWindow[perDay - 1]
  return blocking === undefined
    ? { kind: 'allowed' }
    : { kind: 'refused', availableAt: blocking + window.seconds }
}
