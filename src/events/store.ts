import { asc, eq, min } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { events, relatedLinkEvents, relatedLinks } from '../db/schema'
import { communityHref } from '../communities/community'
import { listEventCommunities } from '../communities/event-communities-store'
import { firstPublicTitle } from '../links/link-page-store'
import type { DeckEvent } from './deck-event'

/**
 * The events a deck is a talk of, once each, in the order their first link
 * was added, each with the community it is shown with, if any.
 */
export async function listDeckEvents(
  database: D1Database,
  deckId: string,
): Promise<readonly DeckEvent[]> {
  const rows = await drizzle(database)
    .select({
      id: events.id,
      service: events.service,
      ref: events.ref,
      host: events.host,
      url: events.url,
      name: events.name,
      firstTitle: firstPublicTitle,
      first: min(relatedLinks.position),
    })
    .from(relatedLinks)
    .innerJoin(
      relatedLinkEvents,
      eq(relatedLinkEvents.link_id, relatedLinks.id),
    )
    .innerJoin(events, eq(events.id, relatedLinkEvents.event_id))
    .where(eq(relatedLinks.deck_id, deckId))
    .groupBy(events.id)
    .orderBy(asc(min(relatedLinks.position)))
    .all()
  const shown = await listEventCommunities(
    database,
    rows.map((row) => row.id),
  )
  return rows.map(({ first: _, ...event }) => {
    const community = shown.get(event.id)
    return {
      ...event,
      community: community
        ? { ...community, href: communityHref(community.handle) }
        : null,
    }
  })
}
