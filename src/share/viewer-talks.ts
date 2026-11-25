import { toCitationCard, type CitationCard } from '../citations/cards'
import type { CitedDeck } from '../citations/store'
import { sharePath } from './path'
import type { ViewerCitations } from './viewer-citations'
import type { ViewerEvent } from './viewer-events-frame'

/** How many cards a section of other talks shows at most (D-56). */
export const SECTION_TALKS = 8

/** From this many other talks of the same event on, it has its own section. */
export const EVENT_SECTION_FROM = 4

/**
 * The public talks read for the event the sections are decided by (the
 * first one added, D-57), newest first, the slides being viewed left out.
 * `otherEvents` is the other events' talks of its community, none of them a
 * talk of this event too; with no community, there are none.
 */
export type TalksRead = Readonly<{
  event: ViewerEvent
  sameEvent: readonly CitedDeck[]
  otherEvents: readonly CitedDeck[]
}>

/** The two sections under the viewer; an empty one is not drawn. */
export type TalkSections<T> = Readonly<{
  sameEvent: readonly T[]
  sameCommunity: readonly T[]
}>

/**
 * Which talks each section shows (D-56, F24-AC38 to F24-AC43). With four or
 * more other talks of the same event, they have their own section and the
 * community's section holds its other events' talks. With fewer, there is
 * the community's section alone, the same event's talks first. An event in
 * no community has the event's section alone. A slide already on the
 * viewer's lists of citations (`shown`, by share path) is left out, so none
 * shows twice; how many talks the event has is counted before that. Each
 * section holds up to SECTION_TALKS.
 */
export function planTalkSections(
  read: TalksRead | null,
  shown: ReadonlySet<string>,
): TalkSections<CitedDeck> {
  if (read === null) return { sameEvent: [], sameCommunity: [] }
  const fresh = (talks: readonly CitedDeck[]) =>
    talks
      .filter((talk) => !shown.has(sharePath(talk.handle, talk.slug)))
      .slice(0, SECTION_TALKS)
  if (read.event.community === null)
    return { sameEvent: fresh(read.sameEvent), sameCommunity: [] }
  if (read.sameEvent.length >= EVENT_SECTION_FROM)
    return {
      sameEvent: fresh(read.sameEvent),
      sameCommunity: fresh(read.otherEvents),
    }
  return {
    sameEvent: [],
    sameCommunity: fresh([...read.sameEvent, ...read.otherEvents]),
  }
}

/** The sections of other talks as the viewer draws them. */
export type ViewerTalks = TalkSections<CitationCard> &
  Readonly<{
    /** The event the sections are of; null when there is none. */
    event: ViewerEvent | null
  }>

export const NO_TALKS: ViewerTalks = {
  event: null,
  sameEvent: [],
  sameCommunity: [],
}

/**
 * The sections of other talks, as cards, leaving out the slides the
 * viewer's lists of citations show. Without a content origin the cards show
 * the names alone.
 */
export function toViewerTalks(
  read: TalksRead | null,
  citations: ViewerCitations,
  contentBase: URL | null,
): ViewerTalks {
  const shown = new Set(
    [...citations.cites.shown, ...citations.citedBy.shown].map(
      (card) => card.href,
    ),
  )
  const sections = planTalkSections(read, shown)
  const card = (deck: CitedDeck) => toCitationCard(deck, contentBase)
  return {
    event: read?.event ?? null,
    sameEvent: sections.sameEvent.map(card),
    sameCommunity: sections.sameCommunity.map(card),
  }
}
