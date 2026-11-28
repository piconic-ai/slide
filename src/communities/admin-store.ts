import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  communities,
  communityAdmins,
  communityFeedEvents,
  communityFollows,
  communityLinks,
  handles,
  notifications,
  profiles,
} from '../db/schema'
import { releaseHandleSteps } from '../handles/store'
import { handleSchema, type Handle } from '../share/handle'
import { imageKey } from './image-policy'
import type { ManagedCommunity } from './manage-page'
import { communityOwner } from './store'

/** One of a community's admins, as its editing page lists them. */
export type CommunityAdmin = Readonly<{
  userId: string
  handle: Handle
  /** The name on their profile, or null without one. */
  name: string | null
}>

/** A community's admins, the first added first. */
export async function listCommunityAdmins(
  database: D1Database,
  communityId: number,
): Promise<readonly CommunityAdmin[]> {
  const rows = await drizzle(database)
    .select({
      userId: communityAdmins.user_id,
      handle: handles.handle,
      name: profiles.name,
    })
    .from(communityAdmins)
    .innerJoin(
      handles,
      and(
        eq(handles.owner_kind, 'person'),
        eq(handles.owner_id, communityAdmins.user_id),
      ),
    )
    .leftJoin(profiles, eq(profiles.user_id, communityAdmins.user_id))
    .where(eq(communityAdmins.community_id, communityId))
    .orderBy(asc(communityAdmins.added_at), asc(communityAdmins.user_id))
    .all()
  return rows.map((row) => ({ ...row, handle: handleSchema.parse(row.handle) }))
}

export type AddAdminResult = 'added' | 'already' | 'no_person'

/**
 * Makes the person a handle names an admin of the community (D-38). A
 * handle a community holds, or nobody, names no person.
 */
export async function addCommunityAdmin(
  database: D1Database,
  input: Readonly<{ communityId: number; handle: Handle; now: number }>,
): Promise<AddAdminResult> {
  const db = drizzle(database)
  const person = await db
    .select({ userId: handles.owner_id })
    .from(handles)
    .where(
      and(eq(handles.handle, input.handle), eq(handles.owner_kind, 'person')),
    )
    .get()
  if (!person) return 'no_person'
  const added = await db
    .insert(communityAdmins)
    .values({
      community_id: input.communityId,
      user_id: person.userId,
      added_at: input.now,
    })
    .onConflictDoNothing()
    .returning({ userId: communityAdmins.user_id })
  return added.length > 0 ? 'added' : 'already'
}

export type RemoveAdminResult = 'removed' | 'last' | 'not_admin'

/**
 * Takes an admin off the community, unless no other admin with a handle
 * would stay (D-38, F30-AC28): one who left the service does not count. One statement counts and removes, so two admins removing each
 * other at once leave one.
 */
export async function removeCommunityAdmin(
  database: D1Database,
  input: Readonly<{ communityId: number; userId: string }>,
): Promise<RemoveAdminResult> {
  const db = drizzle(database)
  const removed = await db
    .delete(communityAdmins)
    .where(
      and(
        eq(communityAdmins.community_id, input.communityId),
        eq(communityAdmins.user_id, input.userId),
        // Someone else who still has a handle stays: an admin who left the
        // service is listed nowhere and runs nothing.
        sql`EXISTS (SELECT 1 FROM ${communityAdmins} AS others
          JOIN ${handles} AS held ON held.owner_kind = 'person'
            AND held.owner_id = others.user_id
          WHERE others.community_id = ${input.communityId}
            AND others.user_id <> ${input.userId})`,
      ),
    )
    .returning({ userId: communityAdmins.user_id })
  if (removed.length > 0) return 'removed'
  const still = await db
    .select({ userId: communityAdmins.user_id })
    .from(communityAdmins)
    .where(
      and(
        eq(communityAdmins.community_id, input.communityId),
        eq(communityAdmins.user_id, input.userId),
      ),
    )
    .get()
  return still ? 'last' : 'not_admin'
}

/**
 * Deletes a community (D-39, F30-AC71): in one batch, its handle is let go
 * of (no one takes it for 90 days, F30-AC8), and its feed events, links,
 * admins, follows and row go. Slides, related links and events stay. Its pictures
 * leave R2 after. False when there was no such community.
 */
export async function deleteCommunity(
  stores: Readonly<{ database: D1Database; bucket: R2Bucket }>,
  input: Readonly<{ communityId: number; now: number }>,
): Promise<boolean> {
  const db = drizzle(stores.database)
  const { communityId } = input
  const links = db
    .select({ id: communityLinks.id })
    .from(communityLinks)
    .where(eq(communityLinks.community_id, communityId))
  const [, , , , , , , gone] = await db.batch([
    ...releaseHandleSteps(db, {
      owner: communityOwner(communityId),
      now: input.now,
    }),
    db
      .delete(communityFeedEvents)
      .where(inArray(communityFeedEvents.link_id, links)),
    db
      .delete(communityLinks)
      .where(eq(communityLinks.community_id, communityId)),
    db
      .delete(communityAdmins)
      .where(eq(communityAdmins.community_id, communityId)),
    // What it told its followers goes with it; the notice names it.
    db.delete(notifications).where(eq(notifications.community_id, communityId)),
    // Its followers no longer follow it (F31-AC13).
    db
      .delete(communityFollows)
      .where(eq(communityFollows.community_id, communityId)),
    db
      .delete(communities)
      .where(eq(communities.id, communityId))
      .returning({ id: communities.id }),
  ])
  await stores.bucket.delete([
    imageKey(communityId, 'logo'),
    imageKey(communityId, 'cover'),
  ])
  return gone.length > 0
}

/** The communities a person runs, by name (F30-AC60). */
export async function listManagedCommunities(
  database: D1Database,
  userId: string,
): Promise<readonly ManagedCommunity[]> {
  const rows = await drizzle(database)
    .select({
      id: communities.id,
      handle: handles.handle,
      name: communities.name,
      color: communities.color,
      logoAt: communities.logo_at,
    })
    .from(communityAdmins)
    .innerJoin(communities, eq(communities.id, communityAdmins.community_id))
    .innerJoin(
      handles,
      and(
        eq(handles.owner_kind, 'community'),
        eq(handles.owner_id, sql`CAST(${communities.id} AS TEXT)`),
      ),
    )
    .where(eq(communityAdmins.user_id, userId))
    .orderBy(asc(communities.name), asc(communities.id))
    .all()
  return rows.map((row) => ({ ...row, handle: handleSchema.parse(row.handle) }))
}

/** A community as the operator's page lists it. */
export type OperatorCommunity = Readonly<{
  id: number
  handle: Handle
  name: string
  admins: readonly Handle[]
  createdAt: number
}>

/** How many communities the operator's page lists, newest first. */
export const OPERATOR_COMMUNITIES = 200

/** The communities, newest first, with the handles of their admins (F30-AC36). */
export async function listOperatorCommunities(
  database: D1Database,
): Promise<readonly OperatorCommunity[]> {
  const db = drizzle(database)
  const rows = await db
    .select({
      id: communities.id,
      handle: handles.handle,
      name: communities.name,
      createdAt: communities.created_at,
    })
    .from(communities)
    .innerJoin(
      handles,
      and(
        eq(handles.owner_kind, 'community'),
        eq(handles.owner_id, sql`CAST(${communities.id} AS TEXT)`),
      ),
    )
    .orderBy(sql`${communities.created_at} DESC`, asc(communities.id))
    .limit(OPERATOR_COMMUNITIES)
    .all()
  const admins = await db
    .select({
      communityId: communityAdmins.community_id,
      handle: handles.handle,
    })
    .from(communityAdmins)
    .innerJoin(
      handles,
      and(
        eq(handles.owner_kind, 'person'),
        eq(handles.owner_id, communityAdmins.user_id),
      ),
    )
    .where(
      inArray(
        communityAdmins.community_id,
        db
          .select({ id: communities.id })
          .from(communities)
          .orderBy(sql`${communities.created_at} DESC`, asc(communities.id))
          .limit(OPERATOR_COMMUNITIES),
      ),
    )
    .orderBy(asc(communityAdmins.added_at))
    .all()
  return rows.map((row) => ({
    ...row,
    handle: handleSchema.parse(row.handle),
    admins: admins
      .filter((admin) => admin.communityId === row.id)
      .map((admin) => handleSchema.parse(admin.handle)),
  }))
}

/** The person a handle names, or null for a community's handle or nobody's. */
export async function findPersonByHandle(
  database: D1Database,
  handle: Handle,
): Promise<string | null> {
  const row = await drizzle(database)
    .select({ userId: handles.owner_id })
    .from(handles)
    .where(and(eq(handles.handle, handle), eq(handles.owner_kind, 'person')))
    .get()
  return row?.userId ?? null
}
