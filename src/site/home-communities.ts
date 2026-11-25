import type { FollowedCommunityTalk } from '../communities/feed-store'
import { citedKey } from '../citations/cited-count'
import { profilePath } from '../share/path'
import { toRecentDeck, type RecentDeck } from '../share/recent'
import type { CommunityColor } from './cover-pattern'
import { HOME_COMMUNITIES_SHOWN } from './home-shape'

/** The community a card of the top page is shown under (F31-AC4). */
export type CardCommunity = Readonly<{
  name: string
  href: string
  color: CommunityColor
}>

/** A recent deck of a followed community, ready to render as is. */
export type CommunityRecentDeck = RecentDeck &
  Readonly<{ community: CardCommunity }>

/**
 * What the top page shows a signed-in visitor of the communities they
 * follow. No slide, a note in the room the section holds (F31-AC16).
 */
export type HomeCommunityLists = Readonly<{
  talks: readonly CommunityRecentDeck[]
}>

/** A slide of a followed community, with links made, for a card. */
export const toCommunityRecentDeck = (
  talk: FollowedCommunityTalk,
  contentBase: URL | null,
  /** How many decks cite each, by `handle/slug`; a deck left out has none. */
  citedBy: ReadonlyMap<string, number> = new Map(),
): CommunityRecentDeck => ({
  ...toRecentDeck(
    talk,
    contentBase,
    citedBy.get(citedKey(talk.handle, talk.slug)),
  ),
  community: {
    name: talk.community.name,
    href: profilePath(talk.community.handle),
    color: talk.community.color,
  },
})

/** The first few slides of the followed communities, newest first. */
export const toHomeCommunities = (
  talks: readonly FollowedCommunityTalk[],
  contentBase: URL | null,
  citedBy: ReadonlyMap<string, number> = new Map(),
): HomeCommunityLists => ({
  talks: talks
    .slice(0, HOME_COMMUNITIES_SHOWN)
    .map((talk) => toCommunityRecentDeck(talk, contentBase, citedBy)),
})
