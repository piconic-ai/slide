import { toRecentDeck, type RecentDeck } from '../share/recent'
import { citedKey } from '../citations/cited-count'
import type { PublicDeck } from '../share/store'

/**
 * What the top page shows a signed-in visitor above the recent slides,
 * ready to render as is. It is made for one person and never cached.
 */
export type HomeLists = Readonly<{
  following: readonly RecentDeck[]
}>

/**
 * The public slides of the people the visitor follows, the most recently
 * published first, as many as were read.
 */
export const toHomeLists = (
  following: readonly PublicDeck[],
  contentBase: URL | null,
  /** How many decks cite each, by `handle/slug`; a deck left out has none. */
  citedBy: ReadonlyMap<string, number> = new Map(),
  /** Each author's picture, by handle. */
  faces: ReadonlyMap<string, string> = new Map(),
): HomeLists => ({
  following: following.map((deck) =>
    toRecentDeck(
      deck,
      contentBase,
      citedBy.get(citedKey(deck.handle, deck.slug)),
      faces.get(deck.handle) ?? null,
    ),
  ),
})
