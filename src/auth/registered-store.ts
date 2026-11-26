import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { authUser } from '../db/auth-schema'
import {
  EmailCryptoError,
  storedForms,
  type EmailCrypto,
} from '../db/email-cipher'
import { accounts } from '../db/schema'

/**
 * Whether this address belongs to a person who has registered: a user whose
 * address it is, with an account (a handle). A person who signed in and has
 * not yet chosen a handle has not registered. The address is looked up in
 * whichever form its row has (plain, or sealed with the lookup value), the
 * same way the invitations are, and never compared with a hash of another
 * kind (docs/dev/f41-email-encryption.md).
 */
export async function isRegistered(
  database: D1Database,
  email: string,
  crypto: EmailCrypto,
): Promise<boolean> {
  if (crypto.kind === 'invalid') throw new EmailCryptoError('not_usable')
  const row = await drizzle(database)
    .select({ id: authUser.id })
    .from(authUser)
    .innerJoin(accounts, eq(accounts.user_id, authUser.id))
    .where(inArray(authUser.email, await storedForms(crypto, email)))
    .get()
  return row !== undefined
}
