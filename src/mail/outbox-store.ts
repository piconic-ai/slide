import { desc, inArray, lt, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { mailOutbox } from '../db/schema'
import {
  EMAIL_CRYPTO_OFF,
  storedForms,
  type EmailCrypto,
} from '../db/email-cipher'
import type { Mail } from './mail'

/** Outbox rows are only for looking at; older ones are dropped on a write. */
const KEEP_SECONDS = 24 * 60 * 60

/**
 * The local stand-in for a mail service: the message is written to a table,
 * not sent. Where no real service is set up, this is the only way a code
 * leaves the service.
 */
export async function writeOutbox(
  database: D1Database,
  mail: Mail,
  now: number,
  keys: EmailCrypto,
): Promise<void> {
  const db = drizzle(database)
  // With the keys on, the address is written as its lookup value, so even a
  // box left on by mistake holds no address (docs/dev/f41-email-encryption.md).
  const stored = (await storedForms(keys, mail.to)).at(-1) as string
  await db.batch([
    db.delete(mailOutbox).where(lt(mailOutbox.created_at, now - KEEP_SECONDS)),
    db.insert(mailOutbox).values({
      id: crypto.randomUUID(),
      to_address: stored,
      subject: mail.subject,
      body: mail.text,
      created_at: now,
    }),
  ])
}

/**
 * The messages written for an address, newest first (by insertion order).
 * Only tests and local checks read the box; they say which keys it was
 * written under (none by default).
 */
export async function readOutbox(
  database: D1Database,
  to: string,
  keys: EmailCrypto = EMAIL_CRYPTO_OFF,
) {
  return drizzle(database)
    .select()
    .from(mailOutbox)
    .where(inArray(mailOutbox.to_address, await storedForms(keys, to)))
    .orderBy(desc(sql`${mailOutbox}.rowid`))
}
