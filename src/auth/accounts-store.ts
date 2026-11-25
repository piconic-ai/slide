import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { authUser } from '../db/auth-schema'
import { accounts, profiles } from '../db/schema'
import { ownsHandle, takeHandle } from '../handles/store'
import type { Handle } from '../share/handle'

export type CreateAccountResult =
  | 'created'
  | 'handle_taken'
  /** The handle was let go of in the last 90 days. */
  | 'handle_held'
  | 'has_account'
  /** Their sign-in records are gone (they left, or the sweep took them). */
  | 'no_user'

/**
 * Gives a person who just signed in for the first time their handle and
 * display name, through `takeHandle`, the same claim a community makes: the
 * shared handle, the account and the profile go in one batch. A handle held
 * by a person or a community, or let go of in the last 90 days, is refused.
 * A person who has an account keeps it: the handle never changes. All rows
 * go in only while the person's `auth_user` row exists, so leaving before
 * signing up or the sweep cannot be followed by an account with no user.
 * The time they agreed to the terms is `now`, the moment the account is made.
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
  const { userId, handle, displayName, now } = input
  const db = drizzle(database)
  const accountOf = () =>
    db
      .select({ handle: accounts.handle })
      .from(accounts)
      .where(eq(accounts.user_id, userId))
      .get()
  if (await accountOf()) return 'has_account'
  const owner = { kind: 'person', id: userId } as const
  const owned = ownsHandle(handle, owner)
  const taken = await takeHandle(database, {
    handle,
    owner,
    now,
    precondition: sql`EXISTS (SELECT 1 FROM ${authUser} WHERE ${authUser.id} = ${userId})
      AND NOT EXISTS (SELECT 1 FROM ${accounts} WHERE ${accounts.user_id} = ${userId})`,
    rest: [
      sql`INSERT INTO ${accounts} (user_id, handle, created_at, terms_accepted_at)
        SELECT ${userId}, ${handle}, ${now}, ${now} WHERE ${owned}`,
      sql`INSERT INTO ${profiles} (user_id, name) SELECT ${userId}, ${displayName}
        WHERE ${owned} ON CONFLICT (user_id) DO UPDATE SET name = excluded.name`,
    ],
  })
  if (taken === 'claimed') return 'created'
  const made = await accountOf()
  if (made) return made.handle === input.handle ? 'created' : 'has_account'
  if (taken === 'taken') return 'handle_taken'
  if (taken === 'held') return 'handle_held'
  return 'no_user'
}
