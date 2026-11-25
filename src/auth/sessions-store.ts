import { and, eq, gt, ne } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { authSession } from '../db/auth-schema'

/** The device a request comes from: whose sign-in, and which of theirs. */
export type CurrentSession = Readonly<{ userId: string; sessionId: string }>

/** How many other devices the person is signed in on, now (F28-AC106). */
export function countOtherSessions(
  database: D1Database,
  current: CurrentSession,
  now: Date,
): Promise<number> {
  return drizzle(database).$count(
    authSession,
    and(
      eq(authSession.userId, current.userId),
      ne(authSession.id, current.sessionId),
      gt(authSession.expiresAt, now),
    ),
  )
}

/** Signs the person out everywhere but the device they ask from. */
export async function endOtherSessions(
  database: D1Database,
  current: CurrentSession,
): Promise<void> {
  await drizzle(database)
    .delete(authSession)
    .where(
      and(
        eq(authSession.userId, current.userId),
        ne(authSession.id, current.sessionId),
      ),
    )
}
