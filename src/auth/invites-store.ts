import { asc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { authUser } from '../db/auth-schema'
import {
  addressOf,
  columnsFor,
  EmailCryptoError,
  storedForms,
  type EmailCrypto,
} from '../db/email-cipher'
import { assertKeysFitData, freshIv } from '../db/email-store'
import { invitedUserIds } from '../db/invitation-schema'
import { invitedEmails } from '../db/schema'
import type { EmailAddress } from '../mail/address'

/** An address cannot be looked up through keys that are set but unusable. */
const usableOrThrow = (crypto: EmailCrypto) => {
  if (crypto.kind === 'invalid') throw new EmailCryptoError('not_usable')
}

/**
 * Whether the operator invited this address, in whichever form its row has
 * (plain, or sealed with the lookup value).
 */
export async function isInvited(
  database: D1Database,
  email: string,
  crypto: EmailCrypto,
): Promise<boolean> {
  usableOrThrow(crypto)
  const row = await drizzle(database)
    .select({ email: invitedEmails.email })
    .from(invitedEmails)
    .where(inArray(invitedEmails.email, await storedForms(crypto, email)))
    .get()
  return row !== undefined
}

/**
 * Adds an address to the invitations; adding it again, in either form,
 * changes nothing. With the keys on the row is sealed, and a plain user of
 * the same address is sealed in the same batch, so the pair stays in one
 * state (docs/dev/f41-email-encryption.md): the user is touched only while
 * a sealed invitation for the address is there.
 */
export async function addInvite(
  database: D1Database,
  input: Readonly<{ email: EmailAddress; invitedBy: string; now: number }>,
  crypto: EmailCrypto,
): Promise<void> {
  usableOrThrow(crypto)
  // Not beside sealed rows with the keys gone or wrong: a plain invitation
  // there would be missed by the sealed user of the same address.
  await assertKeysFitData(database, crypto)
  const forms = await storedForms(crypto, input.email)
  const columns = await columnsFor(crypto, input.email, freshIv())
  const exists = `EXISTS (SELECT 1 FROM invited_emails WHERE email IN (${forms
    .map((_, index) => `?${index + 4}`)
    .join(', ')}))`
  const insert = database
    .prepare(
      `INSERT INTO invited_emails (email, email_ciphertext, invited_at, invited_by)
        SELECT ?1, ?2, ?3, ?${forms.length + 4} WHERE NOT ${exists}`,
    )
    .bind(
      columns.email,
      columns.emailCiphertext,
      input.now,
      ...forms,
      input.invitedBy,
    )
  if (crypto.kind !== 'on') return void (await insert.run())
  const userColumns = await columnsFor(crypto, input.email, freshIv())
  await database.batch([
    insert,
    database
      .prepare(
        `UPDATE auth_user SET email = ?1, email_ciphertext = ?2
          WHERE email = ?3 AND email_ciphertext IS NULL
            AND EXISTS (SELECT 1 FROM invited_emails WHERE email = ?1)`,
      )
      .bind(userColumns.email, userColumns.emailCiphertext, forms[0]),
  ])
}

/** Takes an address off the invitations, whichever form its row has. */
export async function removeInvite(
  database: D1Database,
  email: EmailAddress,
  crypto: EmailCrypto,
): Promise<void> {
  usableOrThrow(crypto)
  await drizzle(database)
    .delete(invitedEmails)
    .where(inArray(invitedEmails.email, await storedForms(crypto, email)))
}

export type Invite = Readonly<{
  email: string
  invitedAt: number
  invitedBy: string
}>

/**
 * Every invitation, oldest first, with its address opened. A row that cannot
 * be opened (a key version taken away too early, a wrong key) fails the
 * whole list rather than being left out: an invitation must not vanish from
 * the operator's view without a word.
 */
export async function listInvites(
  database: D1Database,
  crypto: EmailCrypto,
): Promise<Invite[]> {
  usableOrThrow(crypto)
  const rows = await drizzle(database)
    .select()
    .from(invitedEmails)
    .orderBy(asc(invitedEmails.invited_at), asc(invitedEmails.email))
  return Promise.all(
    rows.map(async (row) => ({
      email: await addressOf(crypto, {
        email: row.email,
        emailCiphertext: row.email_ciphertext,
      }),
      invitedAt: row.invited_at,
      invitedBy: row.invited_by,
    })),
  )
}

/**
 * Whether this person's address is on the invitations now. The two rows are
 * matched by their `email` column, which is the same text when both are in
 * the same state; see `invitedUserIds`.
 */
export async function isInvitedUser(
  database: D1Database,
  userId: string,
): Promise<boolean> {
  const db = drizzle(database)
  const row = await invitedUserIds(db).where(eq(authUser.id, userId)).get()
  return row !== undefined
}
