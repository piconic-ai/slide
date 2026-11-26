import {
  toCommunityCard,
  type CardLogo,
  type ListedCommunity,
} from '../communities/community-card'
import { initialOf } from '../communities/logo'
import type { Person } from '../follows/store'
import type { Handle } from '../share/handle'
import { profilePath } from '../share/path'
import { toRecentDeck, type RecentDeck } from '../share/recent'
import type { PublicDeck } from '../share/store'
import { citedKey } from '../citations/cited-count'
import type { CommunityColor } from './cover-pattern'
import { sourceOf, type DeckSource } from './home-timeline'

/**
 * A person of the carousel (F34-AC19): who they are and nothing they did not
 * write for it. No place, site, bio or count stands on it.
 */
export type DiscoverPerson = Readonly<{
  handle: string
  name: string
  href: string
  /** Where their picture is served from; the initial shows under it. */
  avatarUrl: string | null
  initial: string
}>

/** A community of the carousel (F34-AC20). */
export type DiscoverCommunity = Readonly<{
  handle: string
  name: string
  description: string
  href: string
  logo: CardLogo
}>

/**
 * What the top page's carousels read. `signedIn` tells the follow buttons
 * whether a press follows or asks for a sign-in (F34-AC21, F34-AC22).
 */
export type HomeDiscover = Readonly<{
  signedIn: boolean
  people: readonly DiscoverPerson[]
  communities: readonly DiscoverCommunity[]
}>

/** A person as the carousel's card shows them. */
export const toDiscoverPerson = (person: Person): DiscoverPerson => {
  const name = person.name ?? person.handle
  return {
    handle: person.handle,
    name,
    href: profilePath(person.handle),
    avatarUrl: person.avatarUrl,
    initial: initialOf(name),
  }
}

/** A listed community as the carousel's card shows it. */
export const toDiscoverCommunity = (
  community: ListedCommunity,
): DiscoverCommunity => {
  const card = toCommunityCard(community)
  return {
    handle: community.handle,
    name: card.name,
    description: card.description,
    href: card.href,
    logo: card.logo,
  }
}

/** A slide of the "following" tab, with where it comes from (F34-AC7). */
export type FollowingDeck = RecentDeck & Readonly<{ source: DeckSource }>

/** What the store reads of a slide of the "following" tab. */
export type FollowingSlide = PublicDeck &
  Readonly<{
    /** Whether its author is a person the reader follows. */
    viaPerson: boolean
    /** The community the reader follows that it is in, if any. */
    community: Readonly<{
      handle: Handle
      name: string
      color: CommunityColor
    }> | null
  }>

/**
 * The slides of the "following" tab, as the page draws them. A slide with
 * no source cannot come from the query; it is left out rather than drawn
 * with a wrong one.
 */
export const toFollowingDecks = (
  slides: readonly FollowingSlide[],
  contentBase: URL | null,
  /** How many decks cite each, by `handle/slug`; a deck left out has none. */
  citedBy: ReadonlyMap<string, number> = new Map(),
): readonly FollowingDeck[] =>
  slides.flatMap((slide) => {
    const source = sourceOf({
      person: slide.viaPerson,
      community: slide.community && {
        name: slide.community.name,
        href: profilePath(slide.community.handle),
        color: slide.community.color,
      },
    })
    if (source === null) return []
    return [
      {
        ...toRecentDeck(
          slide,
          contentBase,
          citedBy.get(citedKey(slide.handle, slide.slug)),
        ),
        source,
      },
    ]
  })
