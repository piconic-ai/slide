import { and, asc, eq, ne } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { authUser } from '../db/auth-schema'
import { invitedUserIds } from '../db/invitation-schema'
import { invitedEmails } from '../db/schema'
import type { EmailAddress } from '../mail/address'
import { OPEN_SIGNUP_INVITER } from './signup-mode'

/** Whether the operator invited this address. */
export async function isInvited(
  database: D1Database,
  email: string,
): Promise<boolean> {
  const row = await drizzle(database)
    .select({ email: invitedEmails.email })
    .from(invitedEmails)
    .where(eq(invitedEmails.email, email))
    .get()
  return row !== undefined
}

/**
 * Adds an address to the invitations; adding it again changes nothing,
 * except that the operator inviting an address the service itself let in
 * while sign-up was open turns that row into the operator's.
 */
export async function addInvite(
  database: D1Database,
  input: Readonly<{ email: EmailAddress; invitedBy: string; now: number }>,
): Promise<void> {
  const db = drizzle(database)
  const insert = db
    .insert(invitedEmails)
    .values({
      email: input.email,
      invited_at: input.now,
      invited_by: input.invitedBy,
    })
    .onConflictDoNothing()
  if (input.invitedBy === OPEN_SIGNUP_INVITER) return void (await insert)
  // An open sign-up row is the service's; the operator's invitation is theirs
  // and outlasts the person's leaving, so it takes the row over.
  await db.batch([
    insert,
    db
      .update(invitedEmails)
      .set({ invited_by: input.invitedBy, invited_at: input.now })
      .where(
        and(
          eq(invitedEmails.email, input.email),
          eq(invitedEmails.invited_by, OPEN_SIGNUP_INVITER),
        ),
      ),
  ])
}

/** Takes an address off the invitations. */
export async function removeInvite(
  database: D1Database,
  email: EmailAddress,
): Promise<void> {
  await drizzle(database)
    .delete(invitedEmails)
    .where(eq(invitedEmails.email, email))
}

export type Invite = Readonly<{
  email: string
  invitedAt: number
  invitedBy: string
}>

/**
 * Every invitation the operator made, oldest first. The rows the service
 * made for people who signed up while sign-up was open are not listed: they
 * are people who registered, not invitations, and would fill the page.
 */
export async function listInvites(database: D1Database): Promise<Invite[]> {
  const rows = await drizzle(database)
    .select()
    .from(invitedEmails)
    .where(ne(invitedEmails.invited_by, OPEN_SIGNUP_INVITER))
    .orderBy(asc(invitedEmails.invited_at), asc(invitedEmails.email))
  return rows.map((row) => ({
    email: row.email,
    invitedAt: row.invited_at,
    invitedBy: row.invited_by,
  }))
}

/** Whether this person's address is on the invitations now. */
export async function isInvitedUser(
  database: D1Database,
  userId: string,
): Promise<boolean> {
  const db = drizzle(database)
  const row = await invitedUserIds(db).where(eq(authUser.id, userId)).get()
  return row !== undefined
}
