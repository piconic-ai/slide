import { eq } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { authUser } from './auth-schema'
import { invitedEmails } from './schema'

/**
 * The ids of the people who are signed up and whose address the operator
 * invited now. Better Auth keeps `auth_user.email` lowercase and
 * `invited_emails.email` is held lowercase by a CHECK, so the two compare
 * directly. A person taken off the invitations drops out of it at once.
 * Every check of "is this person still invited" is this one query.
 */
export const invitedUserIds = (db: DrizzleD1Database) =>
  db
    .select({ id: authUser.id })
    .from(authUser)
    .innerJoin(invitedEmails, eq(invitedEmails.email, authUser.email))
