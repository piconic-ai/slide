import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  communities,
  communityAdmins,
  communityFeedEvents,
  communityLinks,
  handles,
  profiles,
} from '../db/schema'
import { releaseHandleSteps } from '../handles/store'
import { handleSchema, type Handle } from '../share/handle'
import { imageKey } from './image-policy'
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
 * Deletes a community (D-39, F30-AC33): in one batch, its handle is let go
 * of (no one takes it for 90 days, F30-AC8), and its feed events, links,
 * admins and row go. Slides, related links and events stay. Its pictures
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
  const [, , , , , gone] = await db.batch([
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
