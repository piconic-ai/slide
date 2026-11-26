// When each simulated reader or author starts. Pure: the random numbers come
// from a seeded generator, so a run can be repeated.

/** A small seeded generator of numbers from 0 up to, not including, 1. */
export function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * `count` starts spread evenly over `seconds`, in milliseconds from the
 * beginning: the first at 0.
 *
 * @param {number} count
 * @param {number} seconds
 */
export function evenStarts(count, seconds) {
  return Array.from(
    { length: count },
    (_, index) => (index * seconds * 1000) / count,
  )
}

/**
 * `count` starts at random moments of the `seconds`, sorted: people arriving
 * at a venue, not on a clock.
 *
 * @param {number} count
 * @param {number} seconds
 * @param {() => number} random
 */
export function randomStarts(count, seconds, random) {
  return Array.from({ length: count }, () => random() * seconds * 1000).sort(
    (a, b) => a - b,
  )
}

/** How many views a rate and a duration make: views per minute over seconds. */
export const viewsIn = (perMinute, seconds) =>
  Math.round((perMinute * seconds) / 60)
