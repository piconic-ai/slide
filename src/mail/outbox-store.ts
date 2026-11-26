import { desc, eq, lt, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { mailOutbox } from '../db/schema'
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
): Promise<void> {
  const db = drizzle(database)
  await db.batch([
    db.delete(mailOutbox).where(lt(mailOutbox.created_at, now - KEEP_SECONDS)),
    db.insert(mailOutbox).values({
      id: crypto.randomUUID(),
      to_address: mail.to,
      subject: mail.subject,
      body: mail.text,
      created_at: now,
    }),
  ])
}

/** The messages written for an address, newest first (by insertion order). */
export async function readOutbox(database: D1Database, to: string) {
  return drizzle(database)
    .select()
    .from(mailOutbox)
    .where(eq(mailOutbox.to_address, to))
    .orderBy(desc(sql`${mailOutbox}.rowid`))
}
