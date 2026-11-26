/** A day of the calendar in UTC, written `YYYY-MM-DD`. */
export type Day = string & { readonly __day: unique symbol }

const DAY = /^\d{4}-\d{2}-\d{2}$/
const SECONDS_PER_DAY = 24 * 60 * 60

/** Whether the text is a real day: the shape and a date that exists. */
export function isDay(text: string): text is Day {
  if (!DAY.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text)
}

/** The UTC day a time in seconds falls on. */
export const dayOf = (seconds: number): Day =>
  new Date(seconds * 1000).toISOString().slice(0, 10) as Day

/** The day `count` days after `day` (before, when negative). */
export function addDays(day: Day, count: number): Day {
  return dayOf(Date.parse(`${day}T00:00:00Z`) / 1000 + count * SECONDS_PER_DAY)
}

/** The first second of the day, in seconds. */
export const startOfDay = (day: Day): number =>
  Date.parse(`${day}T00:00:00Z`) / 1000

/** How many days back, up to yesterday, a copy looks for a day it missed. */
export const COPY_LOOKBACK_DAYS = 7

/**
 * The days a copy made at `at` (seconds) has to write: those of the last
 * seven days, up to yesterday, that are not copied yet, oldest first. Today
 * is not over, so it is never one of them (D-75). A day missed because a
 * copy failed is caught up by the next one.
 */
export function daysToCopy(
  at: number,
  copied: ReadonlySet<string>,
): readonly Day[] {
  const yesterday = addDays(dayOf(at), -1)
  return Array.from({ length: COPY_LOOKBACK_DAYS }, (_, index) =>
    addDays(yesterday, index - (COPY_LOOKBACK_DAYS - 1)),
  ).filter((day) => !copied.has(day))
}
