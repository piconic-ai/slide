import type { EventCommunityView } from '../communities/community'
import type { NamedEvent } from '../links/link-heading'

/**
 * The community an event is shown with, as a page links to it
 * (docs/dev/f30-communities.md): of those it is in, the one whose link was
 * added first.
 */
export type EventCommunity = Readonly<{ name: string; href: string }>

/**
 * An event one slide is a talk of, as its editing page and its viewer list
 * it; the community carries what its logo needs too.
 */
export type DeckEvent = NamedEvent &
  Readonly<{
    id: number
    /** Its address (`events.url`), which its page of links is found by. */
    url: string
    community: (EventCommunityView & EventCommunity) | null
  }>
