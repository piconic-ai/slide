import { asc, eq, min } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { events, relatedLinkEvents, relatedLinks } from '../db/schema'
import type { DeckEvent } from './deck-event'

/**
 * The events a deck is a talk of, once each, in the order their first link
 * was added. Communities are not made yet, so none has one.
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
      name: events.name,
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
  return rows.map(({ first: _, ...event }) => ({ ...event, community: null }))
}
