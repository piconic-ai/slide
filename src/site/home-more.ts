/**
 * How the top page's lists go on past their first cards (F03-AC162,
 * F03-AC163). This file reaches the browser, so it holds no parser; the
 * server reads the same query with src/site/home-more-query.ts.
 *
 * A list asks for its next cards after the last one it shows, by the keys
 * the list is sorted on, not by how many it skipped: a slide published in
 * between then neither repeats a card nor hides one.
 */

/** How many cards one press of "show more" adds at most (F03-AC162). */
export const HOME_MORE_STEP = 100

/** The last slide a list shows, by the keys slides are sorted on. */
export type DeckAfter = Readonly<{
  /** When it was published, in seconds. */
  at: number
  handle: string
  slug: string
}>

/** The last community a list shows, by the keys communities are sorted on. */
export type CommunityAfter = Readonly<{
  /** When it was made, in seconds. */
  at: number
  id: number
}>

/**
 * The query that asks for up to `shown` cards after `after`, and one more,
 * which only tells whether the list goes on past them.
 */
const moreQuery = (
  keys: Readonly<Record<string, string | number>>,
  shown: number,
): string =>
  `?${new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(keys).map(([name, value]) => [name, String(value)]),
    ),
    limit: String(shown + 1),
  })}`

/** The query for the slides after `after`. */
export const deckMoreQuery = (
  after: DeckAfter,
  shown: number = HOME_MORE_STEP,
): string => moreQuery(after, shown)

/** The query for the communities after `after`. */
export const communityMoreQuery = (
  after: CommunityAfter,
  shown: number = HOME_MORE_STEP,
): string => moreQuery(after, shown)

/** The query for a list's first cards, and one more that is not shown. */
export const firstQuery = (shown: number): string =>
  `?${new URLSearchParams({ limit: String(shown + 1) })}`

/**
 * What came, cut to the cards a list shows, and whether more stand after
 * them: the list asked for one card more than it shows.
 */
export const takeShown = <T>(
  came: readonly T[],
  shown: number,
): Readonly<{ cards: readonly T[]; more: boolean }> => ({
  cards: came.slice(0, shown),
  more: came.length > shown,
})
