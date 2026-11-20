/** How many decks each side of a citation shows as running frames. */
export const DECKS_SHOWN = 4

/** The first few of a list, and how many more there are. */
export type Shortened<T> = Readonly<{ shown: readonly T[]; more: number }>

/**
 * Keeps the first `limit` items. Every shown deck is a running frame, so a
 * much-cited deck shows only its latest few and counts the rest.
 */
export function shorten<T>(
  items: readonly T[],
  limit = DECKS_SHOWN,
): Shortened<T> {
  const shown = items.slice(0, Math.max(0, limit))
  return { shown, more: items.length - shown.length }
}
