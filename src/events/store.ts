import {
  and,
  asc,
  count,
  desc,
  eq,
  isNotNull,
  isNull,
  like,
  ne,
  or,
  sql,
} from 'drizzle-orm'
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

/** How many events of one deck the viewer names. */
export const MAX_EVENTS = 5

/** How many talks of an event are read to find the ones to show. */
export const MAX_TALKS = 20

const talkRowSchema = z.object({
  deckId: z.string().nullable(),
  handle: z.string().nullable(),
  deckTitle: z.string().nullable(),
  deploymentId: z.string().nullable(),
  title: z.string().nullable(),
  speaker: z.string().nullable(),
  url: z.string().nullable(),
  embedUrl: z.string().nullable(),
})

const eventSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  url: linkSchema,
  hashtag: hashtagSchema.nullable().catch(null),
  heldOn: heldOnSchema,
  community: z.object({ name: z.string().min(1), url: linkSchema }),
})

/**
 * An event a deck was presented at. Only the latest event carries its other
 * talks: each shown talk is a running frame, so one event's are enough.
 */
export type DeckEvent = Readonly<
  z.infer<typeof eventSchema> & {
    /** The first of its other talks, in the event's order. */
    talks: readonly Talk[]
    /** How many other talks it has in all. */
    talkCount: number
  }
>

/**
 * The events the deck was presented at, latest first, the first with its
 * other talks in the event's order. An event whose stored fields no longer
 * read as an event is left out, as are talks readers should not see.
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
  const [latest, ...earlier] = found
  if (!latest) return []
  // Talks readers may see: slides elsewhere, and other decks public now.
  // Filtering here keeps hidden talks from using up the rows that are read.
  const visible = and(
    eq(eventTalks.event_id, latest.id),
    or(
      and(
        isNull(eventTalks.deck_id),
        sql`trim(${eventTalks.title}) <> ''`,
        like(eventTalks.url, 'https://%'),
      ),
      and(
        ne(eventTalks.deck_id, deckId),
        isNotNull(deployments.id),
        isNotNull(accounts.handle),
      ),
    ),
  )
  const visibleTalks = (fields: Parameters<typeof db.select>[0]) =>
    db
      .select(fields)
      .from(eventTalks)
      .leftJoin(
        decks,
        and(eq(decks.id, eventTalks.deck_id), isNull(decks.deleted_at)),
      )
      .leftJoin(
        deployments,
        and(
          eq(deployments.id, decks.public_deployment_id),
          eq(deployments.deck_id, decks.id),
          eq(deployments.state, 'ready'),
        ),
      )
      .leftJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
      .where(visible)
  const [talkRows, counted] = await Promise.all([
    visibleTalks({
      deckId: eventTalks.deck_id,
      handle: accounts.handle,
      deckTitle: deployments.title,
      deploymentId: deployments.id,
      title: eventTalks.title,
      speaker: eventTalks.speaker,
      url: eventTalks.url,
      embedUrl: eventTalks.embed_url,
    })
      .orderBy(asc(eventTalks.position))
      .limit(MAX_TALKS),
    visibleTalks({ total: count() }),
  ])
  const talks = talkRowSchema
    .array()
    .parse(talkRows)
    .flatMap((row) => {
      const talk = talkOf(row)
      return talk ? [talk] : []
    })
  const total = z.object({ total: z.number().int() }).parse(counted[0]).total
  return [
    // A stored talk that no longer reads as one is counted but not shown.
    { ...latest, talks, talkCount: Math.max(total, talks.length) },
    ...earlier.map((event) => ({ ...event, talks: [], talkCount: 0 })),
  ]
}
