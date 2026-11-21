import { toRecentDeck, type RecentDeck } from '../share/recent'
import type { PublicDeck } from '../share/store'
import { HOME_FOLLOWING_SHOWN } from './home-shape'

/**
 * What the top page shows a signed-in visitor above the recent slides,
 * ready to render as is. It is made for one person and never cached.
 */
export type HomeLists = Readonly<{
  following: readonly RecentDeck[]
}>

/**
 * The public slides of the people the visitor follows, the most recently
 * published first; the first few.
 */
export const toHomeLists = (
  following: readonly PublicDeck[],
  contentBase: URL | null,
): HomeLists => ({
  following: following
    .slice(0, HOME_FOLLOWING_SHOWN)
    .map((deck) => toRecentDeck(deck, contentBase)),
})
