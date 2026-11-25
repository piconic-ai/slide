import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  accounts,
  follows,
  mutes,
  profilePictures,
  profiles,
  suspensions,
} from '../db/schema'
import { facePath, faceSourceOf } from '../profile/face'
import { notifyFollowed } from '../notifications/store'
import { handleSchema, type Handle } from '../share/handle'
import type { PeopleList } from '../share/path'

export type FollowPair = Readonly<{ follower: string; followee: string }>

const matchesPair = ({ follower, followee }: FollowPair) =>
  and(
    eq(follows.follower_user_id, follower),
    eq(follows.followee_user_id, followee),
  )

export async function follow(
  database: D1Database,
  { follower, followee, now }: FollowPair & { now: number },
): Promise<boolean> {
  const result = await drizzle(database).run(sql`
    INSERT INTO ${follows} (follower_user_id, followee_user_id, created_at)
    SELECT follower.user_id, followee.user_id, ${now}
    FROM ${accounts} AS follower JOIN ${accounts} AS followee ON follower.user_id <> followee.user_id
    WHERE follower.user_id = ${follower} AND followee.user_id = ${followee}
      AND NOT EXISTS (SELECT 1 FROM ${mutes}
        WHERE ${mutes.muter_user_id} = follower.user_id AND ${mutes.muted_user_id} = followee.user_id)
      AND NOT EXISTS (SELECT 1 FROM ${suspensions}
        WHERE ${suspensions.user_id} IN (follower.user_id, followee.user_id))
    ON CONFLICT DO NOTHING
  `)
  if (result.meta.changes === 0) return false
  try {
    await notifyFollowed(database, { follower, followee, now })
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'notifications_unrecorded',
        kind: 'followed',
        name: error instanceof Error ? error.name : 'unknown',
      }),
    )
  }
  return true
}

export async function unfollow(database: D1Database, pair: FollowPair) {
  await drizzle(database).delete(follows).where(matchesPair(pair))
}

export async function isFollowing(database: D1Database, pair: FollowPair) {
  const row = await drizzle(database)
    .select({ userId: follows.followee_user_id })
    .from(follows)
    .where(matchesPair(pair))
    .get()
  return row !== undefined
}

/** Whose list is read, which of the two, and who is reading it. */
export type PeopleQuery = Readonly<{
  of: string
  list: PeopleList
  /** The signed-in reader, whose mutes shape what they see. */
  viewer: string | null
}>

/** A person in a following or followers list. */
export type Person = Readonly<{
  userId: string
  handle: Handle
  name: string | null
  avatarUrl: string | null
  /** Whether the reader of the list follows this person. */
  followedByViewer: boolean
}>

/** The other side of each follow: who is followed, or who follows. */
const personOf = (list: PeopleList) =>
  list === 'following' ? follows.followee_user_id : follows.follower_user_id

/**
 * Which follows a list shows, once joined to the people they name. A
 * person who left has no account and a suspended person is shown to
 * nobody; a person the reader muted is not shown to that reader. Lists and
 * counts share this, so a count is the number of people its list shows.
 */
const shownTo = ({ of, list, viewer }: PeopleQuery) =>
  and(
    eq(
      list === 'following'
        ? follows.follower_user_id
        : follows.followee_user_id,
      of,
    ),
    isNull(suspensions.user_id),
    viewer === null
      ? undefined
      : sql`NOT EXISTS (SELECT 1 FROM ${mutes}
          WHERE ${mutes.muter_user_id} = ${viewer}
            AND ${mutes.muted_user_id} = ${personOf(list)})`,
  )

/** How many people the list shows to this reader. */
export async function countPeople(database: D1Database, query: PeopleQuery) {
  const person = personOf(query.list)
  const row = await drizzle(database)
    .select({ count: sql<number>`count(*)` })
    .from(follows)
    .innerJoin(accounts, eq(accounts.user_id, person))
    .leftJoin(suspensions, eq(suspensions.user_id, person))
    .where(shownTo(query))
    .get()
  return row?.count ?? 0
}

/** One page of the list, the newest follow first. */
export async function listPeople(
  database: D1Database,
  query: PeopleQuery & Readonly<{ limit: number; offset: number }>,
): Promise<Person[]> {
  const person = personOf(query.list)
  const rows = await drizzle(database)
    .select({
      userId: accounts.user_id,
      handle: accounts.handle,
      name: profiles.name,
      // What decides each face, read in the same query as the names.
      uploadedAt: profilePictures.uploaded_at,
      useGravatar: profiles.use_gravatar,
      gravatarAt: profiles.gravatar_at,
      followedByViewer:
        query.viewer === null
          ? sql<number>`0`
          : sql<number>`EXISTS (SELECT 1 FROM ${follows} AS own
              WHERE own.follower_user_id = ${query.viewer}
                AND own.followee_user_id = ${accounts.user_id})`,
    })
    .from(follows)
    .innerJoin(accounts, eq(accounts.user_id, person))
    .leftJoin(suspensions, eq(suspensions.user_id, person))
    .leftJoin(profiles, eq(profiles.user_id, person))
    .leftJoin(profilePictures, eq(profilePictures.user_id, person))
    .where(shownTo(query))
    // Follows made in the same second keep one order across pages.
    .orderBy(desc(follows.created_at), person)
    .limit(query.limit)
    .offset(query.offset)
  return rows.map((row) => ({
    userId: row.userId,
    handle: handleSchema.parse(row.handle),
    name: row.name,
    followedByViewer: row.followedByViewer === 1,
    avatarUrl: facePath(
      row.userId,
      faceSourceOf({
        uploadedAt: row.uploadedAt,
        // A person with no profile row yet has Gravatar on, as everyone starts.
        useGravatar: row.useGravatar !== 0,
        gravatarAt: row.gravatarAt,
      }),
    ),
  }))
}
