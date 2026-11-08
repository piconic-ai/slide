import { drizzle } from 'drizzle-orm/d1'
import { authAccount, authSession, authUser } from '../db/auth-schema'

/** Seeds a valid server session for store-level tests that do not issue cookies. */
export async function seedOwnerSession(
  database: D1Database,
  githubId: string,
): Promise<string> {
  const userId = `user-${githubId}`
  const sessionId = `session-${githubId}`
  const db = drizzle(database)
  const now = new Date()
  await db.batch([
    db
      .insert(authUser)
      .values({
        id: userId,
        name: githubId,
        email: `${githubId}@fixture.invalid`,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing(),
    db
      .insert(authAccount)
      .values({
        id: `account-${githubId}`,
        accountId: githubId,
        providerId: 'github',
        userId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing(),
    db
      .insert(authSession)
      .values({
        id: sessionId,
        token: `token-${githubId}`,
        userId,
        expiresAt: new Date(now.getTime() + 43200000),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing(),
  ])
  return sessionId
}
