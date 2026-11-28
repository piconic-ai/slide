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
import { linkTargetOf } from '../links/link-address'
import { firstGatheredTitle, firstPublicTitle } from '../links/link-page-store'
import { EVENT_SERVICES } from '../events/event-url'
import { notBlockedBy } from '../blocks/store'
import { notMutedBy } from '../mutes/store'
import { notHidden } from '../publication/takedown-store'
import { handleSchema } from '../share/handle'
import { COMMUNITY_COLORS } from '../site/cover-pattern'
import { storedSites } from './community-input'
import type { Community, CommunityLink, CommunityTalk } from './community'
import { linkInCommunity, listCommunityLinks } from './store'

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

const slideColumns = {
  deckId: z.string(),
  handle: handleSchema,
  slug: deckSlugSchema,
  title: z.string().nullable(),
  publishedAt: z.number().int(),
  deploymentId: z.string(),
  coverPath: z.string().nullable(),
}
/**
 * A slide of the community under one of its links in it: an event, or a
 * link of another kind with the key it is gathered by.
 */
const talkRow = z.union([
  z.object({
    eventId: z.number().int(),
    service: z.enum(EVENT_SERVICES),
    ref: z.string(),
    host: z.string(),
    url: z.string(),
    name: z.string().nullable(),
    firstTitle: z.string().nullable(),
    ...slideColumns,
  }),
  z.object({
    eventId: z.null(),
    gatherKey: z.string().nullable(),
    firstTitle: z.string().nullable(),
    ...slideColumns,
  }),
])
type TalkRow = z.infer<typeof talkRow>

/**
 * The community's public slides, in one query (the page's cost counts
 * them): each once per link of its own in the community, of any kind
 * (F30-AC65, F30-AC68), with the event of a link kept as one and the key of
 * any other. Newest first: the decks readers may open from a list, as on
 * the top page (a ready public version, not taken down, by an author with a
 * handle, and not by someone the viewer muted or blocked, F30-AC38).
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
      url: events.url,
      name: events.name,
      gatherKey: relatedLinks.gather_key,
      firstTitle: sql<string | null>`CASE WHEN ${events.id} IS NULL
        THEN ${firstGatheredTitle} ELSE ${firstPublicTitle} END`,
      deckId: decks.id,
      handle: accounts.handle,
      slug: decks.slug,
      title: deployments.title,
      publishedAt: publishedAt.as('published_at'),
      deploymentId: deployments.id,
      coverPath: deployments.cover_path,
    })
    .from(decks)
    .innerJoin(accounts, eq(accounts.user_id, decks.owner_user_id))
    .innerJoin(
      deployments,
      and(
        eq(deployments.id, decks.public_deployment_id),
        eq(deployments.deck_id, decks.id),
        eq(deployments.state, 'ready'),
      ),
    )
    // The deck's links in the community: a slide is in it by any of them.
    .innerJoin(
      relatedLinks,
      and(
        eq(relatedLinks.deck_id, decks.id),
        linkInCommunity(communityId, relatedLinks.id),
      ),
    )
    // The event of a link kept as one; none leaves its columns null.
    .leftJoin(relatedLinkEvents, eq(relatedLinkEvents.link_id, relatedLinks.id))
    .leftJoin(events, eq(events.id, relatedLinkEvents.event_id))
    .where(and(notHidden, notMutedBy(viewer), notBlockedBy(viewer)))
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
 * What a row's link is listed as: its event, or, for another kind, the page
 * its key leads to. Null for a key no page is found by (kept before keys
 * were, or one the path of a page does not lead back to).
 */
function linkOf(row: TalkRow): Omit<CommunityLink, 'talks'> | null {
  if (row.eventId !== null) {
    const { service, ref, host, url, name, firstTitle } = row
    return { eventId: row.eventId, service, ref, host, url, name, firstTitle }
  }
  const url = row.gatherKey
  if (url === null || linkTargetOf(url).gatherKey !== url) return null
  return {
    eventId: null,
    service: 'web',
    ref: '',
    host: new URL(url).host,
    url,
    name: null,
    firstTitle: row.firstTitle,
  }
}

/**
 * The community's links with public slides, as their pages gather them (an
 * event by its number, any other by its key), the link whose first public
 * slide is newest first, each with its slides newest first (D-25,
 * F30-AC68); and its slides once each, newest first (F30-AC21). At the same
 * time the newer event comes first, then the other links by their address,
 * so the order never depends on how the rows came.
 */
export async function readCommunityTalks(
  database: D1Database,
  communityId: number,
  viewer: string | null,
): Promise<
  Readonly<{
    links: readonly CommunityLink[]
    slides: readonly CommunityTalk[]
  }>
> {
  const rows = await listTalkRows(database, communityId, viewer)
  type Entry = Omit<CommunityLink, 'talks'> & {
    talks: Map<string, CommunityTalk>
  }
  const byPage = new Map<string, Entry>()
  for (const row of rows) {
    const link = linkOf(row)
    if (!link) continue
    const page = link.eventId === null ? link.url : `event ${link.eventId}`
    const entry = byPage.get(page) ?? { ...link, talks: new Map() }
    // Two links of one slide with one key (`t=30`, `t=60`) list it once.
    entry.talks.set(row.deckId, talkOf(row))
    byPage.set(page, entry)
  }
  const links = [...byPage.values()].map((entry) => ({
    ...entry,
    talks: [...entry.talks.values()],
  }))
  const firstAt = (link: CommunityLink) =>
    Math.min(...link.talks.map((talk) => talk.publishedAt))
  links.sort(
    (a, b) =>
      firstAt(b) - firstAt(a) ||
      (b.eventId ?? 0) - (a.eventId ?? 0) ||
      (a.url < b.url ? -1 : 1),
  )
  // A slide with several links comes once a row; it is listed once.
  const slides = [
    ...new Map(rows.map((row) => [row.deckId, talkOf(row)])).values(),
  ]
  return { links, slides }
}
