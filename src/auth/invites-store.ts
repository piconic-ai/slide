import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { authUser } from '../db/auth-schema'
import { invitedUserIds } from '../db/invitation-schema'
import { invitedEmails } from '../db/schema'
import type { EmailAddress } from '../mail/address'

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

/** Adds an address to the invitations; adding it again changes nothing. */
export async function addInvite(
  database: D1Database,
  input: Readonly<{ email: EmailAddress; invitedBy: string; now: number }>,
): Promise<void> {
  await drizzle(database)
    .insert(invitedEmails)
    .values({
      email: input.email,
      invited_at: input.now,
      invited_by: input.invitedBy,
    })
    .onConflictDoNothing()
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

/** Every invitation, oldest first. */
export async function listInvites(database: D1Database): Promise<Invite[]> {
  const rows = await drizzle(database)
    .select()
    .from(invitedEmails)
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
