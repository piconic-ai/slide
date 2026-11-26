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

/** The sort keys of a slide card, which ask for the slides after it. */
export const deckAfterOf = (
  deck: Readonly<{ publishedAt: string; handle: string; slug: string }>,
): DeckAfter => ({
  at: Date.parse(deck.publishedAt) / 1000,
  handle: deck.handle,
  slug: deck.slug,
})

/** The cards one press of "show more" added, and the request they answer. */
export type AddedCards<T> = Readonly<{ query: string; cards: readonly T[] }>

/**
 * What a tab shows of its list: its first cards (none until they come), the
 * cards each press of "show more" added after them, and whether more stand
 * after those.
 */
export type MoreList<T> = Readonly<{
  first: readonly T[] | undefined
  added: readonly AddedCards<T>[]
  more: boolean
}>

/** A tab's list before anything came. */
export const NOTHING_YET: MoreList<never> = {
  first: undefined,
  added: [],
  more: false,
}

/**
 * The list once an answer came: to the first request, which starts the
 * list over (F03-AC166), or to a press of "show more" (its query), whose
 * cards go after the ones shown (F03-AC162). Each request asked for one
 * card more than it shows, which only tells whether more stand after
 * (F03-AC164).
 *
 * A request may be answered twice: a query that finds a stale answer kept
 * for its URL gives it at once and then the fresh one. A second answer to
 * the request whose cards came last takes their place, so no card comes
 * twice (F03-AC163).
 */
export const receive = <T>(
  list: MoreList<T>,
  came: readonly T[],
  asked: Readonly<
    { kind: 'first'; shown: number } | { kind: 'more'; query: string }
  >,
): MoreList<T> => {
  if (asked.kind === 'first') {
    const { cards, more } = takeShown(came, asked.shown)
    return { first: cards, added: [], more }
  }
  const { cards, more } = takeShown(came, HOME_MORE_STEP)
  const kept =
    list.added.at(-1)?.query === asked.query
      ? list.added.slice(0, -1)
      : list.added
  return {
    first: list.first ?? [],
    added: [...kept, { query: asked.query, cards }],
    more,
  }
}

/** Every card a tab shows, the first ones and those added after them. */
export const shownCards = <T>(list: MoreList<T>): readonly T[] => [
  ...(list.first ?? []),
  ...list.added.flatMap((added) => added.cards),
]
