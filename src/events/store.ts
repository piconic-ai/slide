import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  accounts,
  communities,
  decks,
  deployments,
  events,
  eventTalks,
} from '../db/schema'
import {
  hashtagSchema,
  heldOnSchema,
  linkSchema,
  talkOf,
  type Talk,
} from './talk'

/** How many events of one deck the viewer reads. */
export const MAX_EVENTS = 5

const eventSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  url: linkSchema,
  hashtag: hashtagSchema.nullable().catch(null),
  heldOn: heldOnSchema,
  community: z.object({ name: z.string().min(1), url: linkSchema }),
})

/** An event a deck was presented at, with the event's other talks. */
export type DeckEvent = Readonly<
  z.infer<typeof eventSchema> & { talks: readonly Talk[] }
>

/**
 * The events the deck was presented at, latest first, each with its other
 * talks in the event's order. An event whose stored fields no longer read as
 * an event is left out, as are talks readers should not see.
 */
export async function readDeckEvents(
  database: D1Database,
  deckId: string,
): Promise<DeckEvent[]> {
  const db = drizzle(database)
  const rows = await db
    .select({
      id: events.id,
      name: events.name,
      url: events.url,
      hashtag: events.hashtag,
      heldOn: events.held_on,
      community: { name: communities.name, url: communities.url },
    })
    .from(eventTalks)
    .innerJoin(events, eq(events.id, eventTalks.event_id))
    .innerJoin(communities, eq(communities.id, events.community_id))
    .where(eq(eventTalks.deck_id, deckId))
    .groupBy(events.id)
    .orderBy(desc(events.held_on), events.id)
    .limit(MAX_EVENTS)
  const found = rows.flatMap((row) => {
    const event = eventSchema.safeParse(row)
    return event.success ? [event.data] : []
  })
  if (!found.length) return []
  const talks = await db
    .select({
      eventId: eventTalks.event_id,
      deckId: eventTalks.deck_id,
      handle: accounts.handle,
      deckTitle: deployments.title,
      deploymentId: deployments.id,
      title: eventTalks.title,
      speaker: eventTalks.speaker,
      url: eventTalks.url,
      embedUrl: eventTalks.embed_url,
    })
    .from(eventTalks)
    .leftJoin(
      decks,
      and(eq(decks.id, eventTalks.deck_id), isNull(decks.deleted_at)),
    )
    .leftJoin(
      deployments,
      and(
        eq(deployments.id, decks.public_deployment_id),
        eq(deployments.state, 'ready'),
      ),
    )
    .leftJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .where(
      inArray(
        eventTalks.event_id,
        found.map((event) => event.id),
      ),
    )
    .orderBy(asc(eventTalks.position))
  return found.map((event) => ({
    ...event,
    talks: talks.flatMap((row) => {
      if (row.eventId !== event.id || row.deckId === deckId) return []
      const talk = talkOf(row)
      return talk ? [talk] : []
    }),
  }))
}
