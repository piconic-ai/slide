import {
  and,
  asc,
  eq,
  inArray,
  notInArray,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  communities,
  communityAdmins,
  communityFeedEvents,
  communityLinks,
  events,
  handles,
  relatedLinkEvents,
} from '../db/schema'
import {
  ownsHandle,
  takeHandle,
  type HandleOwner,
  type TakeHandleResult,
} from '../handles/store'
import { handleSchema, type Handle } from '../share/handle'
import type { CommunityColor } from '../site/cover-pattern'
import type { CommunityLink } from './link-rules'

/** The owner a community is in the shared table of handles. */
export const communityOwner = (communityId: number): HandleOwner => ({
  kind: 'community',
  id: String(communityId),
})

/** The links another community already holds, with that community's handle. */
export type LinkConflicts = ReadonlyMap<string, Handle>

/**
 * Of the given links, those another community holds, by URL, with its
 * handle (D-34). `except` is the community asking, whose own links are not
 * a conflict.
 */
export async function findLinkOwners(
  database: D1Database,
  urls: readonly string[],
  except: number | null = null,
): Promise<LinkConflicts> {
  if (urls.length === 0) return new Map()
  const rows = await drizzle(database)
    .select({ url: communityLinks.url, handle: handles.handle })
    .from(communityLinks)
    .innerJoin(
      handles,
      and(
        eq(handles.owner_kind, 'community'),
        eq(handles.owner_id, sql`CAST(${communityLinks.community_id} AS TEXT)`),
      ),
    )
    .where(
      and(
        inArray(communityLinks.url, [...urls]),
        except === null
          ? undefined
          : sql`${communityLinks.community_id} <> ${except}`,
      ),
    )
    .all()
  return new Map(rows.map((row) => [row.url, handleSchema.parse(row.handle)]))
}

const noneHeld = (urls: readonly string[]): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM ${communityLinks} WHERE ${communityLinks.url} IN (${sql.join(
    urls.map((url) => sql`${url}`),
    sql`, `,
  )}))`

const insertLink = (
  communityId: number,
  link: CommunityLink,
  now: number,
  guard: SQL,
): SQL =>
  sql`INSERT INTO ${communityLinks} (community_id, url, kind, host, created_at)
    SELECT ${communityId}, ${link.url}, ${link.kind}, ${link.host}, ${now} WHERE ${guard}`

export type CreateCommunityResult =
  | Readonly<{ kind: 'created' }>
  | Readonly<{
      kind: 'handle'
      reason: Exclude<TakeHandleResult, 'claimed' | 'available'>
    }>
  | Readonly<{ kind: 'links'; conflicts: LinkConflicts }>

/**
 * Makes a community (D-30, D-31): its handle, its row, its one admin (the
 * one who made it) and its links, in one batch through `takeHandle`, so a
 * handle someone holds or let go of in the last 90 days, or a link another
 * community took in the meantime, writes nothing. `id` is the community's
 * number, picked at random by the caller.
 */
export async function createCommunity(
  database: D1Database,
  input: Readonly<{
    id: number
    handle: Handle
    name: string
    color: CommunityColor
    links: readonly CommunityLink[]
    creator: string
    now: number
  }>,
): Promise<CreateCommunityResult> {
  const { id, handle, now } = input
  const urls = input.links.map((link) => link.url)
  const before = await findLinkOwners(database, urls)
  if (before.size > 0) return { kind: 'links', conflicts: before }
  const owner = communityOwner(id)
  const owns = ownsHandle(handle, owner)
  const taken = await takeHandle(database, {
    handle,
    owner,
    now,
    precondition: noneHeld(urls),
    rest: [
      sql`INSERT INTO ${communities} (id, name, color, created_at)
        SELECT ${id}, ${input.name}, ${input.color}, ${now} WHERE ${owns}`,
      sql`INSERT INTO ${communityAdmins} (community_id, user_id, added_at)
        SELECT ${id}, ${input.creator}, ${now} WHERE ${owns}`,
      ...input.links.map((link) => insertLink(id, link, now, owns)),
    ],
  })
  if (taken === 'claimed') return { kind: 'created' }
  if (taken === 'available')
    return {
      kind: 'links',
      conflicts: await findLinkOwners(database, urls),
    }
  return { kind: 'handle', reason: taken }
}

/** A community's link as it is kept. */
export type StoredCommunityLink = CommunityLink & Readonly<{ id: number }>

/** A community's links, in the order they were added. */
export async function listCommunityLinks(
  database: D1Database,
  communityId: number,
): Promise<readonly StoredCommunityLink[]> {
  const rows = await drizzle(database)
    .select({
      id: communityLinks.id,
      kind: communityLinks.kind,
      url: communityLinks.url,
      host: communityLinks.host,
    })
    .from(communityLinks)
    .where(eq(communityLinks.community_id, communityId))
    .orderBy(asc(communityLinks.id))
    .all()
  return rows.flatMap((row): StoredCommunityLink[] =>
    row.kind === 'luma'
      ? [{ id: row.id, kind: 'luma', url: row.url, host: null }]
      : row.host === null
        ? []
        : [{ id: row.id, kind: row.kind, url: row.url, host: row.host }],
  )
}

export type ReplaceLinksResult =
  | Readonly<{ kind: 'saved' }>
  | Readonly<{ kind: 'links'; conflicts: LinkConflicts }>

/**
 * Makes a community's links the given ones (D-35): links no longer given go,
 * with the feed events they brought; new ones are added; links kept stay as
 * they were. Its events follow at once, as they are matched by the links
 * when read. A link another community holds is not taken, and nothing is
 * changed.
 */
export async function replaceCommunityLinks(
  database: D1Database,
  input: Readonly<{
    communityId: number
    links: readonly CommunityLink[]
    now: number
  }>,
): Promise<ReplaceLinksResult> {
  const { communityId, now } = input
  const urls = input.links.map((link) => link.url)
  const conflicts = await findLinkOwners(database, urls, communityId)
  if (conflicts.size > 0) return { kind: 'links', conflicts }
  const db = drizzle(database)
  const kept = and(
    eq(communityLinks.community_id, communityId),
    urls.length === 0 ? undefined : notInArray(communityLinks.url, urls),
  )
  const gone = db
    .select({ id: communityLinks.id })
    .from(communityLinks)
    .where(kept)
  // Prepared statements, so that a link another community took in the
  // meantime fails its insert on the unique url and undoes the whole batch.
  const prepared = (query: {
    toSQL: () => { sql: string; params: unknown[] }
  }) => {
    const { sql: text, params } = query.toSQL()
    return database.prepare(text).bind(...params)
  }
  const inserts = input.links.map((link) =>
    database
      .prepare(
        `INSERT INTO community_links (community_id, url, kind, host, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5
        WHERE NOT EXISTS (
          SELECT 1 FROM community_links WHERE url = ?2 AND community_id = ?1)`,
      )
      .bind(communityId, link.url, link.kind, link.host, now),
  )
  try {
    await database.batch([
      prepared(
        db
          .delete(communityFeedEvents)
          .where(inArray(communityFeedEvents.link_id, gone)),
      ),
      prepared(db.delete(communityLinks).where(kept)),
      ...inserts,
    ])
  } catch (error) {
    // Another community took one of them in the meantime: nothing changed.
    const late = await findLinkOwners(database, urls, communityId)
    if (late.size > 0) return { kind: 'links', conflicts: late }
    throw error
  }
  return { kind: 'saved' }
}

/**
 * The events of a community, as a condition on `events.id` (D-33): those
 * with a link written on the host of one of its links (a connpass event
 * without a group is on connpass.com, which no community holds), and those
 * the feed of one of its Luma calendars lists. Matched when read, so an
 * event made after the community, or a link added or taken away, counts at
 * once (D-35).
 */
export const inCommunity = (
  communityId: number,
  eventId: AnyColumn = events.id,
): SQL =>
  sql`${eventId} IN (
    SELECT ${relatedLinkEvents.event_id} FROM ${relatedLinkEvents}
      JOIN ${communityLinks} ON ${communityLinks.host} = ${relatedLinkEvents.host}
      WHERE ${communityLinks.community_id} = ${communityId}
    UNION
    SELECT ${events.id} FROM ${events}
      JOIN ${communityFeedEvents} ON ${communityFeedEvents.event_key} = ${events.key}
      JOIN ${communityLinks} ON ${communityLinks.id} = ${communityFeedEvents.link_id}
      WHERE ${communityLinks.community_id} = ${communityId})`

/** The numbers of a community's events, whether or not any talk is public. */
export async function listCommunityEventIds(
  database: D1Database,
  communityId: number,
): Promise<readonly number[]> {
  const rows = await drizzle(database)
    .select({ id: events.id })
    .from(events)
    .where(inCommunity(communityId))
    .orderBy(asc(events.id))
    .all()
  return rows.map((row) => row.id)
}

/** A Luma calendar a community holds, for the work that reads its feed. */
export type FeedLink = Readonly<{
  linkId: number
  communityId: number
  url: string
}>

/** Every Luma calendar the communities hold, oldest first. */
export async function listFeedLinks(
  database: D1Database,
): Promise<readonly FeedLink[]> {
  return drizzle(database)
    .select({
      linkId: communityLinks.id,
      communityId: communityLinks.community_id,
      url: communityLinks.url,
    })
    .from(communityLinks)
    .where(eq(communityLinks.kind, 'luma'))
    .orderBy(asc(communityLinks.id))
    .all()
}

/**
 * Puts the events a Luma calendar's feed lists into its community (D-68), by
 * their keys (`eventRefOf(...).key`). Keys already there stay; an event the
 * feed no longer lists is not taken out. Nothing happens for a link that is
 * gone or is not a Luma calendar. For the work that reads the feeds.
 */
export async function addFeedEvents(
  database: D1Database,
  input: Readonly<{ linkId: number; keys: readonly string[]; now: number }>,
): Promise<void> {
  const keys = [...new Set(input.keys)]
  if (keys.length === 0) return
  const db = drizzle(database)
  const link = await db
    .select({ id: communityLinks.id })
    .from(communityLinks)
    .where(
      and(eq(communityLinks.id, input.linkId), eq(communityLinks.kind, 'luma')),
    )
    .get()
  if (!link) return
  // D1 binds at most 100 values a statement; a row takes three.
  for (let start = 0; start < keys.length; start += FEED_ROWS_PER_INSERT)
    await db
      .insert(communityFeedEvents)
      .values(
        keys.slice(start, start + FEED_ROWS_PER_INSERT).map((key) => ({
          link_id: link.id,
          event_key: key,
          added_at: input.now,
        })),
      )
      .onConflictDoNothing()
}

const FEED_ROWS_PER_INSERT = 30

/** Writes what an admin edits about a community: its name, description and other links. */
export async function updateCommunity(
  database: D1Database,
  input: Readonly<{
    communityId: number
    name: string
    description: string
    sites: readonly string[]
  }>,
): Promise<void> {
  await drizzle(database)
    .update(communities)
    .set({
      name: input.name,
      description: input.description,
      sites: JSON.stringify(input.sites),
    })
    .where(eq(communities.id, input.communityId))
}

/** A community's event as its editing page lists it, to rename. */
export type RenamableEvent = Readonly<{
  id: number
  service: (typeof events.$inferSelect)['service']
  ref: string
  host: string
  name: string | null
}>

/** How many events the editing page lists to rename, newest first. */
export const RENAMABLE_EVENTS = 50

/** A community's events, the newest first, to rename. */
export async function listRenamableEvents(
  database: D1Database,
  communityId: number,
): Promise<readonly RenamableEvent[]> {
  return drizzle(database)
    .select({
      id: events.id,
      service: events.service,
      ref: events.ref,
      host: events.host,
      name: events.name,
    })
    .from(events)
    .where(inCommunity(communityId))
    .orderBy(sql`${events.id} DESC`)
    .limit(RENAMABLE_EVENTS)
    .all()
}
