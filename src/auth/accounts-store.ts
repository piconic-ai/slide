import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { accounts, profiles } from '../db/schema'
import type { Handle } from '../share/handle'

export type CreateAccountResult = 'created' | 'handle_taken' | 'has_account'

/**
 * Gives a person who just signed in for the first time their handle and
 * display name, in one batch. The handle is unique, and a person who has an
 * account keeps it: the handle never changes.
 */
export async function createAccount(
  database: D1Database,
  input: Readonly<{
    userId: string
    handle: Handle
    displayName: string
    /** When they agreed to the terms and the privacy policy. */
    termsAcceptedAt: number
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
  try {
    await db.batch([
      db.insert(accounts).values({
        user_id: input.userId,
        handle: input.handle,
        created_at: input.now,
        terms_accepted_at: input.termsAcceptedAt,
      }),
      db
        .insert(profiles)
        .values({ user_id: input.userId, name: input.displayName })
        .onConflictDoUpdate({
          target: profiles.user_id,
          set: { name: input.displayName },
        }),
    ])
    return 'created'
  } catch {
    // The only constraint a valid insert can meet is the unique handle (or
    // a second account made at the same moment).
    const now = await db
      .select({ handle: accounts.handle })
      .from(accounts)
      .where(eq(accounts.user_id, input.userId))
      .get()
    return now ? 'has_account' : 'handle_taken'
  }
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
