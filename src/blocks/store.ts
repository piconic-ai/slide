import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { accounts, blocks, decks, follows, suspensions } from '../db/schema'
import type { DeckColumns } from '../publication/suspension-store'

/** A person in a condition: a user ID, or the column that holds one. */
type Party = string | AnySQLiteColumn | SQL

/**
 * The one exclusion every list shares: `blocker` has not blocked `blocked`.
 * Lists call the narrower helpers below; this is the SQL they all build on.
 */
export const notBlocking = (blocker: Party, blocked: Party) =>
  sql`NOT EXISTS (SELECT 1 FROM ${blocks}
    WHERE ${blocks.blocker_user_id} = ${blocker}
      AND ${blocks.blocked_user_id} = ${blocked})`

/**
 * The deck's owner is not blocked by the viewer; `deck` may be an alias.
 * With no viewer (signed out), no condition. Every list that recommends
 * slides to a reader adds this, beside `notMutedByOf`.
 */
export function notBlockedByOf(deck: DeckColumns, viewer: string | null) {
  return viewer === null ? undefined : notBlocking(viewer, deck.owner_user_id)
}

/** `notBlockedByOf` for the `decks` table itself. */
export const notBlockedBy = (viewer: string | null) =>
  notBlockedByOf(decks, viewer)

export type BlockPair = Readonly<{ blocker: string; blocked: string }>

const matchesPair = ({ blocker, blocked }: BlockPair) =>
  and(eq(blocks.blocker_user_id, blocker), eq(blocks.blocked_user_id, blocked))

export async function hasBlocked(database: D1Database, pair: BlockPair) {
  const row = await drizzle(database)
    .select({ userId: blocks.blocked_user_id })
    .from(blocks)
    .where(matchesPair(pair))
    .get()
  return row !== undefined
}

/**
 * Stores the block and drops the follows both ways, in one batch. Both
 * people must hold an account, and neither may be suspended, in the same
 * statement, so a block that races either one leaving cannot outlive it.
 * Returns true when a new block was stored; blocking again keeps the first.
 */
export async function block(
  database: D1Database,
  { blocker, blocked, now }: BlockPair & { now: number },
): Promise<boolean> {
  if (blocker === blocked) return false
  const db = drizzle(database)
  const eligible = db
    .select({
      blocker_user_id: sql<string>`${blocker}`.as('blocker_user_id'),
      blocked_user_id: accounts.user_id,
      created_at: sql<number>`${now}`.as('created_at'),
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.user_id, blocked),
        sql`EXISTS (SELECT 1 FROM ${accounts} AS blocker
          WHERE blocker.user_id = ${blocker})`,
        sql`NOT EXISTS (SELECT 1 FROM ${suspensions}
          WHERE ${suspensions.user_id} IN (${blocker}, ${blocked}))`,
      ),
    )
  const [result] = await db.batch([
    db.insert(blocks).select(eligible).onConflictDoNothing(),
    // The follows go whenever the block holds, new or not.
    db.delete(follows).where(
      and(
        or(
          and(
            eq(follows.follower_user_id, blocker),
            eq(follows.followee_user_id, blocked),
          ),
          and(
            eq(follows.follower_user_id, blocked),
            eq(follows.followee_user_id, blocker),
          ),
        ),
        sql`EXISTS (SELECT 1 FROM ${blocks}
            WHERE ${blocks.blocker_user_id} = ${blocker}
              AND ${blocks.blocked_user_id} = ${blocked})`,
      ),
    ),
  ])
  return result.meta.changes > 0
}

/** Removes the block. The follows it dropped stay dropped. */
export async function unblock(database: D1Database, pair: BlockPair) {
  await drizzle(database).delete(blocks).where(matchesPair(pair))
}

/** The people the blocker blocked, the latest block first. */
export function listBlocked(database: D1Database, blocker: string) {
  return drizzle(database)
    .select({ userId: accounts.user_id, handle: accounts.handle })
    .from(blocks)
    .innerJoin(accounts, eq(accounts.user_id, blocks.blocked_user_id))
    .where(eq(blocks.blocker_user_id, blocker))
    .orderBy(desc(blocks.created_at), blocks.blocked_user_id)
    .all()
}
