import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { accounts, follows, mutes, suspensions } from '../db/schema'
import { notifyFollowed } from '../notifications/store'
import { handleSchema } from '../share/handle'

type FollowPair = Readonly<{ follower: string; followee: string }>

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

export async function listFollowing(database: D1Database, follower: string) {
  const rows = await drizzle(database)
    .select({ handle: accounts.handle })
    .from(follows)
    .innerJoin(accounts, eq(accounts.user_id, follows.followee_user_id))
    .leftJoin(suspensions, eq(suspensions.user_id, follows.followee_user_id))
    .where(
      and(eq(follows.follower_user_id, follower), isNull(suspensions.user_id)),
    )
    .orderBy(desc(follows.created_at), follows.followee_user_id)
  return handleSchema.array().parse(rows.map(({ handle }) => handle))
}
