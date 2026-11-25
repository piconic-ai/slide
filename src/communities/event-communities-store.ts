import { and, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  communities,
  communityAdmins,
  communityFeedEvents,
  communityLinks,
  events,
  handles,
  relatedLinkEvents,
} from '../db/schema'
import { handleSchema } from '../share/handle'
import { COMMUNITY_COLORS } from '../site/cover-pattern'
import type { EventCommunityView } from './community'

/** D1 binds at most 100 values a statement; the lists asked for are short. */
const MAX_EVENTS_ASKED = 40

/** Which communities each of the events is in, by the link that brings it. */
async function listMatches(database: D1Database, eventIds: readonly number[]) {
  const ids = [...new Set(eventIds)].slice(0, MAX_EVENTS_ASKED)
  if (ids.length === 0) return []
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )
  return drizzle(database).all<{
    eventId: number
    communityId: number
    linkId: number
  }>(
    sql`SELECT ${relatedLinkEvents.event_id} AS eventId,
        ${communityLinks.community_id} AS communityId, ${communityLinks.id} AS linkId
      FROM ${relatedLinkEvents}
      JOIN ${communityLinks} ON ${communityLinks.host} = ${relatedLinkEvents.host}
      WHERE ${relatedLinkEvents.event_id} IN (${list})
    UNION
    SELECT ${events.id}, ${communityLinks.community_id}, ${communityLinks.id}
      FROM ${events}
      JOIN ${communityFeedEvents} ON ${communityFeedEvents.event_key} = ${events.key}
      JOIN ${communityLinks} ON ${communityLinks.id} = ${communityFeedEvents.link_id}
      WHERE ${events.id} IN (${list})`,
  )
}

const viewRow = z.object({
  id: z.number().int(),
  handle: handleSchema,
  name: z.string(),
  color: z.enum(COMMUNITY_COLORS),
  logoAt: z.number().int().nullable(),
  coverAt: z.number().int().nullable(),
})

/**
 * The community each event is shown with, by the event's number: of the
 * communities it is in, the one whose matching link was added first. An
 * event in none has no entry.
 */
export async function listEventCommunities(
  database: D1Database,
  eventIds: readonly number[],
): Promise<ReadonlyMap<number, EventCommunityView>> {
  const matches = await listMatches(database, eventIds)
  const first = new Map<number, { communityId: number; linkId: number }>()
  for (const match of matches) {
    const kept = first.get(match.eventId)
    if (!kept || match.linkId < kept.linkId) first.set(match.eventId, match)
  }
  const communityIds = [
    ...new Set([...first.values()].map((m) => m.communityId)),
  ]
  if (communityIds.length === 0) return new Map()
  const rows = await drizzle(database)
    .select({
      id: communities.id,
      handle: handles.handle,
      name: communities.name,
      color: communities.color,
      logoAt: communities.logo_at,
      coverAt: communities.cover_at,
    })
    .from(communities)
    .innerJoin(
      handles,
      and(
        eq(handles.owner_kind, 'community'),
        eq(handles.owner_id, sql`CAST(${communities.id} AS TEXT)`),
      ),
    )
    .where(inArray(communities.id, communityIds))
    .all()
  const byId = new Map(
    viewRow
      .array()
      .parse(rows)
      .map((row) => [row.id, row]),
  )
  return new Map(
    [...first.entries()].flatMap(([eventId, { communityId }]) => {
      const community = byId.get(communityId)
      return community ? [[eventId, community] as const] : []
    }),
  )
}

/**
 * The people who run a community the event is in: they may rename it
 * (F29-AC22).
 */
export async function listEventAdmins(
  database: D1Database,
  eventId: number,
): Promise<ReadonlySet<string>> {
  const communityIds = [
    ...new Set(
      (await listMatches(database, [eventId])).map((m) => m.communityId),
    ),
  ]
  if (communityIds.length === 0) return new Set()
  const rows = await drizzle(database)
    .selectDistinct({ userId: communityAdmins.user_id })
    .from(communityAdmins)
    .where(inArray(communityAdmins.community_id, communityIds))
    .all()
  return new Set(rows.map((row) => row.userId))
}
