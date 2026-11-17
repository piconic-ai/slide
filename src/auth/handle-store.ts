import { and, eq, ne, notExists } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { accounts } from '../db/schema'
import type { Handle } from '../share/handle'

/**
 * Whether the handle a first sign-in would give this person is held by
 * someone else. A person who already has a handle keeps it whatever their
 * GitHub login is now, so nothing is taken from them.
 */
export async function isHandleTaken(
  database: D1Database,
  userId: string,
  handle: Handle,
): Promise<boolean> {
  const db = drizzle(database)
  const row = await db
    .select({ user_id: accounts.user_id })
    .from(accounts)
    .where(
      and(
        eq(accounts.handle, handle),
        ne(accounts.user_id, userId),
        notExists(
          db
            .select({ user_id: accounts.user_id })
            .from(accounts)
            .where(eq(accounts.user_id, userId)),
        ),
      ),
    )
    .get()
  return row !== undefined
}
