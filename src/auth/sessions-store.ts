import { and, desc, eq, gt } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { authSession } from '../db/auth-schema'

/** The device a request comes from: whose sign-in, and which of theirs. */
export type CurrentSession = Readonly<{ userId: string; sessionId: string }>

/** One device the person is signed in on, as settings list it. */
export type DeviceSession = Readonly<{
  id: string
  /** The rough name, or null when the agent told nothing (F28-AC111). */
  device: string | null
  signedInAt: Date
  /** When the session was last renewed: the last use, to the hour. */
  lastUsedAt: Date
  current: boolean
}>

/** The devices the person is signed in on now: this one, then the latest sign-in first. */
export async function listDeviceSessions(
  database: D1Database,
  current: CurrentSession,
  now: Date,
): Promise<readonly DeviceSession[]> {
  const rows = await drizzle(database)
    .select({
      id: authSession.id,
      device: authSession.device,
      signedInAt: authSession.createdAt,
      lastUsedAt: authSession.updatedAt,
    })
    .from(authSession)
    .where(
      and(
        eq(authSession.userId, current.userId),
        gt(authSession.expiresAt, now),
      ),
    )
    .orderBy(desc(authSession.createdAt), desc(authSession.id))
    .all()
  // The device asking comes first; the rest stay newest first.
  return rows
    .map((row) => ({ ...row, current: row.id === current.sessionId }))
    .sort((a, b) => Number(b.current) - Number(a.current))
}

/** Signs out one of the person's own devices; anyone else's stays (F28-AC110). */
export async function endSession(
  database: D1Database,
  owner: Readonly<{ userId: string }>,
  sessionId: string,
): Promise<void> {
  await drizzle(database)
    .delete(authSession)
    .where(
      and(eq(authSession.userId, owner.userId), eq(authSession.id, sessionId)),
    )
}
