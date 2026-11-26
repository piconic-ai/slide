import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { alias, type SQLiteColumn } from 'drizzle-orm/sqlite-core'
import {
  accounts,
  citations,
  communities,
  communityFollows,
  decks,
  deployments,
  events,
  follows,
  handles,
  mutes,
  relatedLinkEvents,
  relatedLinks,
  notificationOptOuts,
  notifications,
  suspensions,
} from '../db/schema'
import { notBlocking } from '../blocks/store'
import { inCommunity } from '../communities/store'
import { notHidden } from '../publication/takedown-store'
import {
  notificationKindSchema,
  notificationSchema,
  type Notification,
  type NotificationKind,
} from './notification'

const target = alias(decks, 'cited_deck')
const targetVersion = alias(deployments, 'cited_version')
const publicVersionOf = (deck: typeof decks | typeof target) =>
  deck.public_deployment_id

function actorNotMuted(recipient: SQLiteColumn, actor: SQLiteColumn | string) {
  return sql`NOT EXISTS (SELECT 1 FROM ${mutes}
    WHERE ${mutes.muter_user_id} = ${recipient} AND ${mutes.muted_user_id} = ${actor})`
}

function receivesFrom(
  recipient: SQLiteColumn,
  actor: SQLiteColumn | string,
  kind: NotificationKind,
) {
  return and(
    actorNotMuted(recipient, actor),
    notBlocking(recipient, actor),
    sql`NOT EXISTS (SELECT 1 FROM ${notificationOptOuts}
      WHERE ${notificationOptOuts.user_id} = ${recipient} AND ${notificationOptOuts.kind} = ${kind})`,
  )
}

export async function notifyFollowed(
  database: D1Database,
  {
    follower,
    followee,
    now,
  }: Readonly<{ follower: string; followee: string; now: number }>,
) {
  await drizzle(database).run(sql`
    INSERT INTO ${notifications} (id, recipient_user_id, kind, actor_user_id, created_at)
    SELECT lower(hex(randomblob(16))), ${accounts.user_id}, 'followed', ${follower}, ${now}
    FROM ${accounts}
    WHERE ${accounts.user_id} = ${followee}
      AND EXISTS (SELECT 1 FROM ${accounts} WHERE ${accounts.user_id} = ${follower})
      AND ${receivesFrom(accounts.user_id, follower, 'followed')}
    ON CONFLICT DO NOTHING
  `)
}

export async function notifyFolloweePublished(
  database: D1Database,
  { deckId, now }: Readonly<{ deckId: string; now: number }>,
) {
  await drizzle(database).run(sql`
    INSERT INTO ${notifications} (id, recipient_user_id, kind, actor_user_id, deck_id, created_at)
    SELECT lower(hex(randomblob(16))), ${follows.follower_user_id}, 'followee_published',
           ${decks.owner_user_id}, ${decks.id}, ${now}
    FROM ${follows}
    JOIN ${decks} ON ${decks.id} = ${deckId} AND ${decks.owner_user_id} = ${follows.followee_user_id}
    WHERE ${receivesFrom(follows.follower_user_id, decks.owner_user_id, 'followee_published')}
    ON CONFLICT DO NOTHING
  `)
}

/**
 * Tells the people who follow a community that a public slide is in it
 * (F20-AC15), once each however many of their communities it is in: the
 * community shown is the one they followed first, as in the follow feed.
 * "In" is read when this runs (inCommunity, D-35). The author is never
 * told of their own slide, and the same slide is not told twice to someone
 * who already has the notice from the person they follow (the unique index
 * notifications_deck_once). Neither a follower the author blocked nor an
 * author the follower blocked is told or told of: a block does not undo a
 * community follow, so it is checked here, both ways.
 */
export async function notifyCommunityPublished(
  database: D1Database,
  {
    deckId,
    now,
    eventKey,
  }: Readonly<{
    deckId: string
    now: number
    /**
     * When a link was just added or changed, only the communities that this
     * event puts the slide into count; the slide's other events do not.
     */
    eventKey?: string
  }>,
) {
  await drizzle(database).run(sql`
    INSERT INTO ${notifications} (id, recipient_user_id, kind, actor_user_id, deck_id, community_id, created_at)
    SELECT lower(hex(randomblob(16))), recipient, 'community_published', author, deck, community, ${now}
    FROM (
      SELECT ${communityFollows.user_id} AS recipient, ${decks.owner_user_id} AS author,
        ${decks.id} AS deck, ${communityFollows.community_id} AS community,
        ROW_NUMBER() OVER (PARTITION BY ${communityFollows.user_id}
          ORDER BY ${communityFollows.created_at}, ${communities.id}) AS pick
      FROM ${communityFollows}
      JOIN ${communities} ON ${communities.id} = ${communityFollows.community_id}
      JOIN ${relatedLinkEvents}
        ON ${inCommunity(communityFollows.community_id, relatedLinkEvents.event_id)}
      JOIN ${relatedLinks} ON ${relatedLinks.id} = ${relatedLinkEvents.link_id}
      JOIN ${decks} ON ${decks.id} = ${relatedLinks.deck_id}
      JOIN ${deployments} ON ${deployments.id} = ${decks.public_deployment_id}
        AND ${deployments.deck_id} = ${decks.id}
        AND ${deployments.state} = 'ready'
      WHERE ${decks.id} = ${deckId}
        AND ${
          eventKey === undefined
            ? sql`1`
            : sql`${relatedLinkEvents.event_id} = (SELECT ${events.id} FROM ${events} WHERE ${events.key} = ${eventKey})`
        }
        AND ${isNull(decks.deleted_at)}
        AND ${notHidden}
        AND ${communityFollows.user_id} <> ${decks.owner_user_id}
        AND ${receivesFrom(communityFollows.user_id, decks.owner_user_id, 'community_published')}
        AND ${notBlocking(decks.owner_user_id, communityFollows.user_id)}
    )
    WHERE pick = 1
    ON CONFLICT DO NOTHING
  `)
}

/**
 * notifyCommunityPublished for a caller whose own work has already
 * succeeded, such as a link added to a public slide: a failure is logged
 * and does not reach the author.
 */
export async function notifyCommunityPublishedQuietly(
  database: D1Database,
  input: Readonly<{ deckId: string; now: number; eventKey?: string }>,
) {
  try {
    await notifyCommunityPublished(database, input)
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'notifications_unrecorded',
        deckId: input.deckId,
        name: error instanceof Error ? error.name : 'unknown',
      }),
    )
  }
}

export async function notifyCited(
  database: D1Database,
  { deckId, now }: Readonly<{ deckId: string; now: number }>,
) {
  await drizzle(database).run(sql`
    INSERT INTO ${notifications} (id, recipient_user_id, kind, actor_user_id, deck_id, target_deck_id, created_at)
    SELECT lower(hex(randomblob(16))), ${accounts.user_id}, 'cited', ${decks.owner_user_id},
           ${decks.id}, ${target.id}, ${now}
    FROM ${citations}
    JOIN ${decks} ON ${decks.id} = ${deckId} AND ${publicVersionOf(decks)} = ${citations.deployment_id}
    JOIN ${accounts} ON ${accounts.handle} = ${citations.target_handle}
    JOIN ${decks} AS ${target} ON ${target.owner_user_id} = ${accounts.user_id}
      AND ${target.slug} = ${citations.target_slug} AND ${target.deleted_at} IS NULL
    WHERE ${accounts.user_id} <> ${decks.owner_user_id}
      AND ${receivesFrom(accounts.user_id, decks.owner_user_id, 'cited')}
    GROUP BY ${accounts.user_id}, ${decks.id}, ${target.id}
    ON CONFLICT DO NOTHING
  `)
}

/**
 * What a recipient is shown, for the list and the unread count alike. Both
 * join the actor's account, the citing deck and the cited deck first.
 */
const visibleTo = (userId: string) =>
  and(
    eq(notifications.recipient_user_id, userId),
    actorNotMuted(notifications.recipient_user_id, notifications.actor_user_id),
    notBlocking(notifications.recipient_user_id, notifications.actor_user_id),
    sql`NOT EXISTS (SELECT 1 FROM ${suspensions}
      WHERE ${suspensions.user_id} = ${notifications.actor_user_id})`,
    or(
      eq(notifications.kind, 'followed'),
      and(
        isNotNull(publicVersionOf(decks)),
        notHidden,
        isNull(decks.deleted_at),
        or(
          eq(notifications.kind, 'followee_published'),
          eq(notifications.kind, 'community_published'),
          and(
            eq(notifications.kind, 'cited'),
            isNotNull(target.id),
            isNull(target.deleted_at),
            isNull(target.hidden_at),
          ),
        ),
      ),
    ),
  )

export async function listNotifications(
  database: D1Database,
  userId: string,
  limit: number,
): Promise<Notification[]> {
  const rows = await drizzle(database)
    .select({
      id: notifications.id,
      kind: notifications.kind,
      at: notifications.created_at,
      readAt: notifications.read_at,
      actorHandle: accounts.handle,
      deckSlug: decks.slug,
      deckTitle: deployments.title,
      targetSlug: target.slug,
      targetTitle: targetVersion.title,
      communityHandle: handles.handle,
      communityName: communities.name,
    })
    .from(notifications)
    .innerJoin(accounts, eq(accounts.user_id, notifications.actor_user_id))
    .leftJoin(decks, eq(decks.id, notifications.deck_id))
    .leftJoin(target, eq(target.id, notifications.target_deck_id))
    .leftJoin(deployments, eq(deployments.id, publicVersionOf(decks)))
    .leftJoin(targetVersion, eq(targetVersion.id, publicVersionOf(target)))
    .leftJoin(communities, eq(communities.id, notifications.community_id))
    .leftJoin(
      handles,
      and(
        eq(handles.owner_kind, 'community'),
        eq(handles.owner_id, sql`CAST(${communities.id} AS TEXT)`),
      ),
    )
    .where(visibleTo(userId))
    .orderBy(desc(notifications.created_at), desc(notifications.id))
    .limit(limit)
  return notificationSchema.array().parse(rows)
}

export async function countUnread(database: D1Database, userId: string) {
  const [row] = await drizzle(database)
    .select({ total: count() })
    .from(notifications)
    .innerJoin(accounts, eq(accounts.user_id, notifications.actor_user_id))
    .leftJoin(decks, eq(decks.id, notifications.deck_id))
    .leftJoin(target, eq(target.id, notifications.target_deck_id))
    .where(and(visibleTo(userId), isNull(notifications.read_at)))
  return row.total
}

/**
 * Marks what the recipient can see now as read and returns their IDs. A
 * notification that is left out for the moment stays unread, so it is not
 * missed when it returns.
 */
export async function markAllRead(
  database: D1Database,
  userId: string,
  now: number,
) {
  const db = drizzle(database)
  const visible = db
    .select({ id: notifications.id })
    .from(notifications)
    .innerJoin(accounts, eq(accounts.user_id, notifications.actor_user_id))
    .leftJoin(decks, eq(decks.id, notifications.deck_id))
    .leftJoin(target, eq(target.id, notifications.target_deck_id))
    .where(and(visibleTo(userId), isNull(notifications.read_at)))
  const marked = await db
    .update(notifications)
    .set({ read_at: now })
    .where(inArray(notifications.id, visible))
    .returning({ id: notifications.id })
  return new Set(marked.map((row) => row.id))
}

/**
 * The recipient's list as they open it: what was unread is marked read
 * first, in one statement, and still shown as new. A notification that
 * arrives after that statement stays unread, so its arrival is not lost.
 */
export async function openNotifications(
  database: D1Database,
  userId: string,
  limit: number,
  now: number,
): Promise<Notification[]> {
  const fresh = await markAllRead(database, userId, now)
  const items = await listNotifications(database, userId, limit)
  return items.map((item) =>
    fresh.has(item.id) ? { ...item, unread: true } : item,
  )
}

export async function readOptOuts(database: D1Database, userId: string) {
  const rows = await drizzle(database)
    .select({ kind: notificationOptOuts.kind })
    .from(notificationOptOuts)
    .where(eq(notificationOptOuts.user_id, userId))
    .orderBy(notificationOptOuts.kind)
  return notificationKindSchema.array().parse(rows.map((row) => row.kind))
}

export async function setReceive(
  database: D1Database,
  userId: string,
  kind: NotificationKind,
  receive: boolean,
) {
  const db = drizzle(database)
  if (receive) {
    await db
      .delete(notificationOptOuts)
      .where(
        and(
          eq(notificationOptOuts.user_id, userId),
          eq(notificationOptOuts.kind, kind),
        ),
      )
  } else {
    await db
      .insert(notificationOptOuts)
      .values({ user_id: userId, kind })
      .onConflictDoNothing()
  }
}
