import { listEventCommunities } from '../communities/event-communities-store'
import { listDeckEvents } from '../events/store'
import type { ViewerEvent } from './viewer-events-frame'

/**
 * The events a deck is a talk of, in the order their first link was added,
 * each with the community it is shown with and what its logo needs.
 */
export async function listViewerEvents(
  database: D1Database,
  deckId: string,
): Promise<readonly ViewerEvent[]> {
  const events = await listDeckEvents(database, deckId)
  const inCommunity = events.filter((event) => event.community !== null)
  const shown =
    inCommunity.length === 0
      ? new Map()
      : await listEventCommunities(
          database,
          inCommunity.map((event) => event.id),
        )
  return events.map(({ community: _, ...event }) => ({
    ...event,
    community: shown.get(event.id) ?? null,
  }))
}
