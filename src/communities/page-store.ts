import { and, asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import {
  accounts,
  communities,
  communityAdmins,
  decks,
  deployments,
  events,
  handles,
  relatedLinkEvents,
  relatedLinks,
} from '../db/schema'
import { deckSlugSchema } from '../decks/deck-id'
import { EVENT_SERVICES } from '../events/event-url'
import { notBlockedBy } from '../blocks/store'
import { notMutedBy } from '../mutes/store'
import { notHidden } from '../publication/takedown-store'
import { handleSchema } from '../share/handle'
import { COMMUNITY_COLORS } from '../site/cover-pattern'
import { storedSites } from './community-input'
import type { Community, CommunityEvent, CommunityTalk } from './community'
import { inCommunity, listCommunityLinks } from './store'

const communityRow = z.object({
  id: z.number().int().positive(),
  handle: handleSchema,
  name: z.string(),
  description: z.string(),
  color: z.enum(COMMUNITY_COLORS),
  sites: z.string(),
  logoAt: z.number().int().nullable(),
  coverAt: z.number().int().nullable(),
})

/**
 * A community with its handle and links, or null when there is none (or
 * it holds no handle, which a community being deleted may not).
 */
export async function findCommunity(
  database: D1Database,
  communityId: number,
): Promise<Community | null> {
  const [row, links] = await Promise.all([
    drizzle(database)
      .select({
        id: communities.id,
        handle: handles.handle,
        name: communities.name,
        description: communities.description,
        color: communities.color,
        sites: communities.sites,
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
      .where(eq(communities.id, communityId))
      .get(),
    listCommunityLinks(database, communityId),
  ])
  if (!row) return null
  const parsed = communityRow.parse(row)
  return { ...parsed, sites: storedSites(parsed.sites), links }
}

/** Whether the person runs the community. */
export async function isCommunityAdmin(
  database: D1Database,
  communityId: number,
  userId: string,
): Promise<boolean> {
  const row = await drizzle(database)
    .select({ userId: communityAdmins.user_id })
    .from(communityAdmins)
    .where(
      and(
        eq(communityAdmins.community_id, communityId),
        eq(communityAdmins.user_id, userId),
      ),
    )
    .get()
  return row !== undefined
}

// When a deck was first published; a deck published before the column was
// added has the time its public version became ready.
const publishedAt = sql<number>`coalesce(${decks.first_published_at}, ${deployments.ready_at})`

const talkRow = z.object({
  eventId: z.number().int(),
  service: z.enum(EVENT_SERVICES),
  ref: z.string(),
  host: z.string(),
  name: z.string().nullable(),
  deckId: z.string(),
  handle: handleSchema,
  slug: deckSlugSchema,
  title: z.string().nullable(),
  publishedAt: z.number().int(),
  deploymentId: z.string(),
  coverPath: z.string().nullable(),
})
type TalkRow = z.infer<typeof talkRow>

/**
 * Every public talk of the community's events, once per event and deck,
 * newest first: the decks readers may open from a list, as on the top page
 * (a ready public version, not taken down, by an author with a handle, and
 * not by someone the viewer muted or blocked, F30-AC38).
 */
async function listTalkRows(
  database: D1Database,
  communityId: number,
  viewer: string | null,
): Promise<readonly TalkRow[]> {
  const rows = await drizzle(database)
    .selectDistinct({
      eventId: events.id,
      service: events.service,
      ref: events.ref,
      host: events.host,
      name: events.name,
      deckId: decks.id,
      handle: accounts.handle,
      slug: decks.slug,
      title: deployments.title,
      publishedAt: publishedAt.as('published_at'),
      deploymentId: deployments.id,
      coverPath: deployments.cover_path,
    })
    .from(relatedLinkEvents)
    .innerJoin(events, eq(events.id, relatedLinkEvents.event_id))
    .innerJoin(relatedLinks, eq(relatedLinks.id, relatedLinkEvents.link_id))
    .innerJoin(
      decks,
      and(
        eq(decks.id, relatedLinks.deck_id),
        notHidden,
        notMutedBy(viewer),
        notBlockedBy(viewer),
      ),
    )
    .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .innerJoin(
      deployments,
      and(
        eq(deployments.id, decks.public_deployment_id),
        eq(deployments.deck_id, decks.id),
        eq(deployments.state, 'ready'),
      ),
    )
    .where(inCommunity(communityId, relatedLinkEvents.event_id))
    .orderBy(sql`published_at DESC`, asc(decks.slug), asc(events.id))
    .all()
  return talkRow.array().parse(rows)
}

const talkOf = (row: TalkRow): CommunityTalk => ({
  deckId: row.deckId,
  handle: row.handle,
  slug: row.slug,
  title: row.title,
  publishedAt: row.publishedAt,
  deploymentId: row.deploymentId,
  coverPath: row.coverPath,
})

/**
 * The community's events with public talks, the event whose first public
 * talk is newest first (the same time, the newer event first), each with
 * its talks newest first (D-25, F30-AC19); and its talks once each, newest
 * first (F30-AC21).
 */
export async function readCommunityTalks(
  database: D1Database,
  communityId: number,
  viewer: string | null,
): Promise<
  Readonly<{
    events: readonly CommunityEvent[]
    slides: readonly CommunityTalk[]
  }>
> {
  const rows = await listTalkRows(database, communityId, viewer)
  const byEvent = new Map<number, { event: TalkRow; talks: CommunityTalk[] }>()
  for (const row of rows) {
    const entry = byEvent.get(row.eventId) ?? { event: row, talks: [] }
    entry.talks.push(talkOf(row))
    byEvent.set(row.eventId, entry)
  }
  const firstAt = (talks: readonly CommunityTalk[]) =>
    Math.min(...talks.map((talk) => talk.publishedAt))
  const listed = [...byEvent.values()]
    .map(({ event, talks }) => ({
      id: event.eventId,
      service: event.service,
      ref: event.ref,
      host: event.host,
      name: event.name,
      talks,
    }))
    .sort((a, b) => firstAt(b.talks) - firstAt(a.talks) || b.id - a.id)
  const slides = [
    ...new Map(rows.map((row) => [row.deckId, talkOf(row)])).values(),
  ]
  return { events: listed, slides }
}
