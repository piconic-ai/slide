import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { accounts } from '../db/schema'
import type { Handle } from '../share/handle'

export type CreateAccountResult =
  | 'created'
  | 'handle_taken'
  | 'has_account'
  /** Their sign-in records are gone (they left, or the sweep took them). */
  | 'no_user'

/**
 * Gives a person who just signed in for the first time their handle and
 * display name, in one batch. The handle is unique, and a person who has an
 * account keeps it: the handle never changes. Both rows go in only while the
 * person's `auth_user` row exists, in the same statements, so leaving before
 * signing up or the sweep cannot be followed by an account with no user. The
 * time they agreed to the terms is `now`, the moment the account is made.
 */
export async function createAccount(
  database: D1Database,
  input: Readonly<{
    userId: string
    handle: Handle
    displayName: string
    now: number
  }>,
): Promise<CreateAccountResult> {
  const db = drizzle(database)
  const existing = await db
    .select({ handle: accounts.handle })
    .from(accounts)
    .where(eq(accounts.user_id, input.userId))
    .get()
  if (existing) return 'has_account'
  const userExists = 'EXISTS (SELECT 1 FROM auth_user WHERE id = ?1)'
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO accounts (user_id, handle, created_at, terms_accepted_at)
           SELECT ?1, ?2, ?3, ?3 WHERE ${userExists}`,
        )
        .bind(input.userId, input.handle, input.now),
      database
        .prepare(
          `INSERT INTO profiles (user_id, name) SELECT ?1, ?2 WHERE ${userExists}
           ON CONFLICT (user_id) DO UPDATE SET name = excluded.name`,
        )
        .bind(input.userId, input.displayName),
    ])
  } catch {
    // The only constraint a valid insert can meet is the unique handle (or
    // a second account made at the same moment).
  }
  const made = await db
    .select({ handle: accounts.handle })
    .from(accounts)
    .where(eq(accounts.user_id, input.userId))
    .get()
  if (made) return made.handle === input.handle ? 'created' : 'has_account'
  const user = await database
    .prepare('SELECT 1 AS found FROM auth_user WHERE id = ?1')
    .bind(input.userId)
    .first()
  return user ? 'handle_taken' : 'no_user'
}

/** Whether another person holds this handle. */
export async function isHandleHeld(
  database: D1Database,
  handle: Handle,
): Promise<boolean> {
  const row = await drizzle(database)
    .select({ id: accounts.user_id })
    .from(accounts)
    .where(eq(accounts.handle, handle))
    .get()
  return row !== undefined
}
