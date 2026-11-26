import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { authUser } from '../db/auth-schema'
import { accounts } from '../db/schema'

/**
 * Whether this address belongs to a person who has registered: a user whose
 * address it is, with an account (a handle). A person who signed in and has
 * not yet chosen a handle has not registered. The address is in the one
 * spelling the service stores (`normalizeAddress`), as the invitations' is.
 */
export async function isRegistered(
  database: D1Database,
  email: string,
): Promise<boolean> {
  const row = await drizzle(database)
    .select({ id: authUser.id })
    .from(authUser)
    .innerJoin(accounts, eq(accounts.user_id, authUser.id))
    .where(eq(authUser.email, email))
    .get()
  return row !== undefined
}
