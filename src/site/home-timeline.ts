/**
 * The top page's one timeline (F44): how many slides it shows first, where
 * its two carousels stand among them, and where each slide of the "following"
 * tab comes from. This file reaches the browser, so it holds no parser and
 * reads nothing; the server reads the same constants.
 */
import type { CommunityColor } from './cover-pattern'

/** How many slides the timeline shows first (F44-AC12). */
export const HOME_TIMELINE_FIRST = 12

/** How many people, and how many communities, a carousel holds (F44-AC17). */
export const HOME_CAROUSEL_SHOWN = 12

/** The two carousels the "all" timeline holds. */
export type CarouselKind = 'people' | 'communities'

/**
 * Where each carousel stands: after this many slides of the first reading
 * (F44-AC15). The people come a little above the communities. Both are even,
 * so at two across a carousel never splits a row of slides.
 */
export const CAROUSEL_AFTER: Readonly<Record<CarouselKind, number>> = {
  people: 4,
  communities: 10,
}

/** The carousels in the order they stand, which breaks a tie in position. */
const CAROUSEL_ORDER: readonly CarouselKind[] = ['people', 'communities']

/** One place of the timeline: a slide, or a carousel between slides. */
export type TimelineItem<Deck> =
  | Readonly<{ kind: 'deck'; deck: Deck }>
  | Readonly<{ kind: 'carousel'; carousel: CarouselKind }>

/**
 * The timeline's items: the slides of the first reading with each carousel
 * that has something to show set in at its place, then the slides "show
 * more" added, which never take a carousel (F44-AC16). A carousel whose
 * place is past the last slide that came stands after that slide, people
 * first, and stands even among no slide at all (F44-AC15).
 */
export const timelineItems = <Deck>(
  first: readonly Deck[],
  added: readonly Deck[],
  present: Readonly<Record<CarouselKind, boolean>>,
): readonly TimelineItem<Deck>[] => {
  const shown = CAROUSEL_ORDER.filter((carousel) => present[carousel])
  const carousel = (kind: CarouselKind): TimelineItem<Deck> => ({
    kind: 'carousel',
    carousel: kind,
  })
  const items: TimelineItem<Deck>[] = []
  first.forEach((deck, index) => {
    items.push({ kind: 'deck', deck })
    for (const kind of shown)
      if (CAROUSEL_AFTER[kind] === index + 1) items.push(carousel(kind))
  })
  // The carousels whose place is past the last slide that came.
  for (const kind of shown)
    if (CAROUSEL_AFTER[kind] > first.length) items.push(carousel(kind))
  for (const deck of added) items.push({ kind: 'deck', deck })
  return items
}

/** The community a slide reached the reader through. */
export type SourceCommunity = Readonly<{
  name: string
  href: string
  color: CommunityColor
}>

/** Where a slide of the "following" tab comes from (F44-AC7). */
export type DeckSource =
  | Readonly<{ kind: 'person' }>
  | (Readonly<{ kind: 'community' }> & SourceCommunity)

/**
 * The source a slide of the "following" tab is shown with: the community it
 * is in when it is in one the reader follows, even when its author is
 * followed too, as the author already stands on the card; otherwise the
 * followed author. Null for a slide that is neither, which the list never
 * reads.
 */
export const sourceOf = (
  via: Readonly<{ person: boolean; community: SourceCommunity | null }>,
): DeckSource | null => {
  if (via.community !== null) return { kind: 'community', ...via.community }
  return via.person ? { kind: 'person' } : null
}
