import { addDays, dayOf, startOfDay, type Day } from './day'

/** A week: seven days from a Monday (UTC), named by that Monday. */
export type Week = Readonly<{ start: Day; end: Day }>

/** How many weeks the table shows by default (02-PAGES 15). */
export const DEFAULT_WEEKS = 12

/** The Monday of the week a day is in. */
export function mondayOf(day: Day): Day {
  // 1970-01-01 was a Thursday, so a Monday is 4 days into a week of 7.
  const index = Math.floor(startOfDay(day) / 86400)
  return addDays(day, -((index + 3) % 7))
}

/**
 * The last `count` weeks up to and including the one `at` (seconds) is in,
 * oldest first. The newest is still going on, so it holds fewer days.
 */
export function lastWeeks(at: number, count = DEFAULT_WEEKS): readonly Week[] {
  const newest = mondayOf(dayOf(at))
  return Array.from({ length: count }, (_, index) => {
    const start = addDays(newest, 7 * (index - (count - 1)))
    return { start, end: addDays(start, 6) }
  })
}
