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
  decks,
  deployments,
  follows,
  mutes,
  notificationOptOuts,
  notifications,
  suspensions,
} from '../db/schema'
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
    WHERE ${publicVersionOf(decks)} IS NOT NULL
      AND ${receivesFrom(follows.follower_user_id, decks.owner_user_id, 'followee_published')}
    ON CONFLICT DO NOTHING
  `)
}

export async function notifyJoined(
  database: D1Database,
  {
    actorUserId,
    recipientUserIds,
    now,
  }: Readonly<{
    actorUserId: string
    recipientUserIds: readonly string[]
    now: number
  }>,
) {
  if (!recipientUserIds.length) return
  await drizzle(database).run(sql`
    INSERT INTO ${notifications} (id, recipient_user_id, kind, actor_user_id, created_at)
    SELECT lower(hex(randomblob(16))), ${accounts.user_id}, 'github_followee_joined', ${actorUserId}, ${now}
    FROM ${accounts}
    WHERE ${accounts.user_id} IN (SELECT value FROM json_each(${JSON.stringify(recipientUserIds)}))
      AND EXISTS (SELECT 1 FROM ${accounts} WHERE ${accounts.user_id} = ${actorUserId})
      AND ${accounts.user_id} <> ${actorUserId}
      AND NOT EXISTS (SELECT 1 FROM ${suspensions} WHERE ${suspensions.user_id} = ${accounts.user_id})
      AND ${receivesFrom(accounts.user_id, actorUserId, 'github_followee_joined')}
    ON CONFLICT DO NOTHING
  `)
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
    sql`NOT EXISTS (SELECT 1 FROM ${suspensions}
      WHERE ${suspensions.user_id} = ${notifications.actor_user_id})`,
    or(
      inArray(notifications.kind, ['github_followee_joined', 'followed']),
      and(
        isNotNull(publicVersionOf(decks)),
        notHidden,
        isNull(decks.deleted_at),
        or(
          eq(notifications.kind, 'followee_published'),
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
    })
    .from(notifications)
    .innerJoin(accounts, eq(accounts.user_id, notifications.actor_user_id))
    .leftJoin(decks, eq(decks.id, notifications.deck_id))
    .leftJoin(target, eq(target.id, notifications.target_deck_id))
    .leftJoin(deployments, eq(deployments.id, publicVersionOf(decks)))
    .leftJoin(targetVersion, eq(targetVersion.id, publicVersionOf(target)))
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
