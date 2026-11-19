import { ownDeckName, type OwnDeck } from '../decks/own-decks'
import { coverUrl } from '../share/cover'
import { toRecentDeck, type RecentDeck } from '../share/recent'
import type { PublicDeck } from '../share/store'
import { HOME_FOLLOWING_SHOWN, HOME_OWN_SHOWN } from './home-shape'

/** One of the visitor's own slides as the top page shows it. */
export type HomeOwnDeck = Readonly<{
  name: string
  /** The slide's own page, where its author manages it. */
  href: string
  coverUrl: string | null
  /** Whether readers can open it now; otherwise only its author can. */
  isPublic: boolean
}>

/**
 * What the top page shows a signed-in visitor above the recent slides,
 * ready to render as is. It is made for one person and never cached.
 */
export type HomeLists = Readonly<{
  own: readonly HomeOwnDeck[]
  following: readonly RecentDeck[]
}>

const toHomeOwnDeck = (
  deck: OwnDeck,
  contentBase: URL | null,
): HomeOwnDeck => ({
  name: ownDeckName(deck),
  href: `/slides/${deck.slug}`,
  coverUrl:
    deck.shown && contentBase
      ? coverUrl(contentBase, deck.shown.deploymentId, deck.shown.coverPath)
      : null,
  isPublic: deck.isPublic,
})

/**
 * The visitor's own slides, the most recently changed first, and the public
 * slides of the people they follow, the most recently published first; the
 * first few of each.
 */
export const toHomeLists = (
  own: readonly OwnDeck[],
  following: readonly PublicDeck[],
  contentBase: URL | null,
): HomeLists => ({
  own: own
    .slice(0, HOME_OWN_SHOWN)
    .map((deck) => toHomeOwnDeck(deck, contentBase)),
  following: following
    .slice(0, HOME_FOLLOWING_SHOWN)
    .map((deck) => toRecentDeck(deck, contentBase)),
})
