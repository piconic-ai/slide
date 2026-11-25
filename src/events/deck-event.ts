import type { NamedEvent } from './event-name'

/**
 * The community an event is shown with, as a page links to it
 * (docs/dev/f30-communities.md): of those it is in, the one whose link was
 * added first.
 */
export type EventCommunity = Readonly<{ name: string; href: string }>

/** An event one slide is a talk of, as its editing page lists it. */
export type DeckEvent = NamedEvent &
  Readonly<{ id: number; community: EventCommunity | null }>

/** The community of each event, by the event's number. */
export const communitiesOf = (
  events: readonly DeckEvent[],
): ReadonlyMap<number, EventCommunity | null> =>
  new Map(events.map((event) => [event.id, event.community]))
